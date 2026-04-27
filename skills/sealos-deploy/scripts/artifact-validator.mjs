#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.join(__dirname, '..', 'schemas')

const SCHEMA_FILES = {
  config: 'config.schema.json',
  analysis: 'analysis.schema.json',
  'build-result': 'build-result.schema.json',
  state: 'state.schema.json',
  'workflow-state': 'workflow-state.schema.json',
}

const WORKFLOW_STEP_NAMES = [
  'preflight',
  'assess',
  'detect-image',
  'dockerfile',
  'build-push',
  'template',
  'deploy',
  'validate-artifacts',
]

const WORKFLOW_STEP_NAME_SET = new Set(WORKFLOW_STEP_NAMES)
const WORKFLOW_PENDING_GATE_KINDS = ['auth', 'input', 'confirmation']
const WORKFLOW_PENDING_GATE_KIND_SET = new Set(WORKFLOW_PENDING_GATE_KINDS)
const WORKFLOW_PENDING_GATE_NAMES = [
  'region-selection',
  'sealos-auth',
  'workspace-selection',
  'workspace-change-confirmation',
  'deploy-inputs',
  'restart-confirmation',
  'deploy-apply-confirmation',
  'deployment-mode-confirmation',
]
const WORKFLOW_PENDING_GATE_NAME_SET = new Set(WORKFLOW_PENDING_GATE_NAMES)

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function formatPath(pointer, suffix = '') {
  return `${pointer}${suffix}`
}

function pushError(errors, pointer, message) {
  errors.push({ path: pointer, message })
}

function validateType(expectedType, value) {
  switch (expectedType) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'integer':
      return Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function validateAgainstSchema(schema, value, pointer = '$', errors = []) {
  if (schema.anyOf) {
    const branches = schema.anyOf.map((candidate) => {
      const branchErrors = []
      validateAgainstSchema(candidate, value, pointer, branchErrors)
      return branchErrors
    })

    if (!branches.some((branchErrors) => branchErrors.length === 0)) {
      pushError(errors, pointer, 'does not match any allowed schema')
    }
    return errors
  }

  if (schema.oneOf) {
    const branches = schema.oneOf.map((candidate) => {
      const branchErrors = []
      validateAgainstSchema(candidate, value, pointer, branchErrors)
      return branchErrors
    })
    const validCount = branches.filter((branchErrors) => branchErrors.length === 0).length
    if (validCount !== 1) {
      pushError(errors, pointer, `expected exactly one schema match, got ${validCount}`)
    }
    return errors
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    pushError(errors, pointer, `must equal ${JSON.stringify(schema.const)}`)
    return errors
  }

  if (schema.enum && !schema.enum.includes(value)) {
    pushError(errors, pointer, `must be one of ${schema.enum.join(', ')}`)
    return errors
  }

  if (schema.type && !validateType(schema.type, value)) {
    pushError(errors, pointer, `must be of type ${schema.type}`)
    return errors
  }

  switch (schema.type) {
    case 'object':
      validateObjectSchema(schema, value, pointer, errors)
      break
    case 'array':
      validateArraySchema(schema, value, pointer, errors)
      break
    case 'string':
      validateStringSchema(schema, value, pointer, errors)
      break
    case 'integer':
    case 'number':
      validateNumberSchema(schema, value, pointer, errors)
      break
    default:
      break
  }

  return errors
}

function validateObjectSchema(schema, value, pointer, errors) {
  const keys = Object.keys(value)

  if (schema.required) {
    for (const requiredKey of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        pushError(errors, pointer, `missing required property ${requiredKey}`)
      }
    }
  }

  if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) {
    pushError(errors, pointer, `must have at least ${schema.minProperties} properties`)
  }

  const properties = schema.properties || {}
  const patternProperties = schema.patternProperties || {}
  const compiledPatterns = Object.entries(patternProperties).map(([pattern, childSchema]) => ({
    regex: new RegExp(pattern),
    schema: childSchema,
  }))

  for (const [key, childValue] of Object.entries(value)) {
    const childPointer = formatPath(pointer, `.${key}`)

    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      validateAgainstSchema(properties[key], childValue, childPointer, errors)
      continue
    }

    const matched = compiledPatterns.filter(({ regex }) => regex.test(key))
    if (matched.length > 0) {
      for (const candidate of matched) {
        validateAgainstSchema(candidate.schema, childValue, childPointer, errors)
      }
      continue
    }

    if (schema.additionalProperties === false) {
      pushError(errors, childPointer, 'is not allowed')
      continue
    }

    if (isPlainObject(schema.additionalProperties)) {
      validateAgainstSchema(schema.additionalProperties, childValue, childPointer, errors)
    }
  }
}

function validateArraySchema(schema, value, pointer, errors) {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    pushError(errors, pointer, `must contain at least ${schema.minItems} items`)
  }

  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    pushError(errors, pointer, `must contain at most ${schema.maxItems} items`)
  }

  if (schema.uniqueItems) {
    const seen = new Set()
    for (let index = 0; index < value.length; index++) {
      const encoded = JSON.stringify(value[index])
      if (seen.has(encoded)) {
        pushError(errors, formatPath(pointer, `[${index}]`), 'must be unique')
      }
      seen.add(encoded)
    }
  }

  if (schema.items) {
    for (let index = 0; index < value.length; index++) {
      validateAgainstSchema(schema.items, value[index], formatPath(pointer, `[${index}]`), errors)
    }
  }
}

function validateStringSchema(schema, value, pointer, errors) {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    pushError(errors, pointer, `must be at least ${schema.minLength} characters long`)
  }

  if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
    pushError(errors, pointer, `must match pattern ${schema.pattern}`)
  }

  if (schema.format === 'date-time' && !isIsoDateTime(value)) {
    pushError(errors, pointer, 'must be a valid ISO 8601 date-time')
  }
}

function validateNumberSchema(schema, value, pointer, errors) {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    pushError(errors, pointer, `must be >= ${schema.minimum}`)
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    pushError(errors, pointer, `must be <= ${schema.maximum}`)
  }
}

function loadSchema(kind) {
  const fileName = SCHEMA_FILES[kind]
  if (!fileName) {
    throw new Error(`Unknown artifact kind: ${kind}`)
  }

  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, fileName), 'utf-8'))
}

function validateAnalysisSemantics(data, errors) {
  if (!data.all_languages.includes(data.language)) {
    pushError(errors, '$.all_languages', 'must include the primary language')
  }

  const dimensionTotal = Object.values(data.score.dimensions).reduce((sum, value) => sum + value, 0)
  if (data.score.total !== dimensionTotal) {
    pushError(errors, '$.score.total', `must equal the sum of score.dimensions (${dimensionTotal})`)
  }

  if (!Object.prototype.hasOwnProperty.call(data.runtime_version, data.language)) {
    pushError(errors, '$.runtime_version', `must include a version field for primary language ${data.language}`)
  }

  if (typeof data.image_ref === 'string' && !data.image_ref.includes(':')) {
    pushError(errors, '$.image_ref', 'must include an explicit image tag')
  }
}

function validateBuildResultSemantics(data, errors) {
  const startedAt = Date.parse(data.build.started_at)
  const finishedAt = Date.parse(data.finished_at)

  if (!Number.isNaN(startedAt) && !Number.isNaN(finishedAt) && finishedAt < startedAt) {
    pushError(errors, '$.finished_at', 'must not be earlier than build.started_at')
  }

  if (data.registry === 'ghcr' && !data.push.remote_image.startsWith('ghcr.io/')) {
    pushError(errors, '$.push.remote_image', 'must be a GHCR image when registry is ghcr')
  }

  if (data.registry === 'dockerhub' && data.push.remote_image.startsWith('ghcr.io/')) {
    pushError(errors, '$.push.remote_image', 'must not be a GHCR image when registry is dockerhub')
  }

  if (!data.push.remote_image.includes(':')) {
    pushError(errors, '$.push.remote_image', 'must include an explicit image tag')
  }
}

function validateStateSemantics(data, errors) {
  const { last_deploy: lastDeploy, history } = data
  const forbiddenWorkflowFields = [
    'current_step',
    'steps_completed',
    'checkpoints',
    'resume',
    'last_error',
    'pending_gate',
  ]

  for (const forbiddenField of forbiddenWorkflowFields) {
    if (Object.prototype.hasOwnProperty.call(data, forbiddenField)) {
      pushError(errors, `$.${forbiddenField}`, 'must not appear in .sealos/state.json deploy facts')
    }
  }

  if (history[0]?.action !== 'deploy') {
    pushError(errors, '$.history[0].action', 'the first history entry must be deploy')
  }

  if (history[0]?.status !== 'success') {
    pushError(errors, '$.history[0].status', 'the first history entry must be successful')
  }

  const deployedAt = Date.parse(lastDeploy.deployed_at)
  const updatedAt = Date.parse(lastDeploy.last_updated_at)
  if (!Number.isNaN(deployedAt) && !Number.isNaN(updatedAt) && updatedAt < deployedAt) {
    pushError(errors, '$.last_deploy.last_updated_at', 'must not be earlier than deployed_at')
  }

  try {
    const host = new URL(lastDeploy.url).hostname
    if (!host.endsWith(`.${lastDeploy.region}`)) {
      pushError(errors, '$.last_deploy.url', 'hostname must end with .<region>')
    }
  } catch {
    pushError(errors, '$.last_deploy.url', 'must be a valid https URL')
  }

  let previousAt = null
  let latestSuccessfulImage = null
  for (let index = 0; index < history.length; index++) {
    const entry = history[index]
    const at = Date.parse(entry.at)

    if (previousAt !== null && !Number.isNaN(at) && at < previousAt) {
      pushError(errors, `$.history[${index}].at`, 'must be in non-decreasing chronological order')
    }
    if (!Number.isNaN(at)) {
      previousAt = at
    }

    if (entry.action === 'set-image' && entry.image === entry.previous_image) {
      pushError(errors, `$.history[${index}].image`, 'must differ from previous_image for set-image actions')
    }

    if ((entry.action === 'deploy' || entry.action === 'set-image') && entry.status === 'success') {
      latestSuccessfulImage = entry.image
    }
  }

  if (latestSuccessfulImage && latestSuccessfulImage !== lastDeploy.image) {
    pushError(errors, '$.last_deploy.image', 'must match the latest successful image-changing history entry')
  }
}

function validateWorkflowStepName(step, pointer, errors) {
  if (step !== null && !WORKFLOW_STEP_NAME_SET.has(step)) {
    pushError(errors, pointer, `must be one of ${WORKFLOW_STEP_NAMES.join(', ')}`)
  }
}

function validateWorkflowPendingGate(gate, errors) {
  if (!gate) {
    return
  }

  if (!WORKFLOW_PENDING_GATE_KIND_SET.has(gate.kind)) {
    pushError(errors, '$.pending_gate.kind', `must be one of ${WORKFLOW_PENDING_GATE_KINDS.join(', ')}`)
  }

  if (!WORKFLOW_PENDING_GATE_NAME_SET.has(gate.name)) {
    pushError(errors, '$.pending_gate.name', `must be one of ${WORKFLOW_PENDING_GATE_NAMES.join(', ')}`)
  }

  if (gate.status !== 'waiting') {
    pushError(errors, '$.pending_gate.status', 'must equal waiting')
  }

  if (!isIsoDateTime(gate.created_at)) {
    pushError(errors, '$.pending_gate.created_at', 'must be a valid ISO 8601 date-time')
  }

  if (gate.expires_at !== null && !isIsoDateTime(gate.expires_at)) {
    pushError(errors, '$.pending_gate.expires_at', 'must be null or a valid ISO 8601 date-time')
  }
}

function validateWorkflowStateSemantics(data, errors) {
  if (!['deploy', 'update'].includes(data.execution_mode)) {
    pushError(errors, '$.execution_mode', 'must be deploy or update')
  }

  if (typeof data.execution_summary !== 'string' || data.execution_summary.trim().length === 0) {
    pushError(errors, '$.execution_summary', 'must be a non-empty string')
  }

  if (data.execution_mode === 'update' && !data.update_target) {
    pushError(errors, '$.update_target', 'must be present when execution_mode is update')
  }

  if (data.execution_mode !== 'update' && data.update_target) {
    pushError(errors, '$.update_target', 'must be null unless execution_mode is update')
  }

  if (data.deployment_choice === 'update' && data.execution_mode !== 'update') {
    pushError(errors, '$.deployment_choice', 'cannot be update when execution_mode is deploy')
  }

  if (data.update_attempt) {
    if (data.update_attempt.max_attempts < data.update_attempt.attempt) {
      pushError(errors, '$.update_attempt.max_attempts', 'must be >= attempt')
    }

    if (data.update_attempt.exhausted && data.update_attempt.attempt !== data.update_attempt.max_attempts) {
      pushError(errors, '$.update_attempt.exhausted', 'must only be true on the final allowed attempt')
    }

    if (data.update_attempt.terminal_failure && !data.update_attempt.last_failure_message) {
      pushError(errors, '$.update_attempt.last_failure_message', 'must be present for terminal update failures')
    }

    if (data.update_attempt.terminal_failure && data.update_attempt.exhausted === false) {
      pushError(errors, '$.update_attempt.exhausted', 'must not be false when terminal_failure is true')
    }

    if (data.update_attempt.rollback_completed_at && !data.update_attempt.terminal_failure) {
      pushError(errors, '$.update_attempt.rollback_completed_at', 'must be null unless terminal_failure is true')
    }

    if (data.update_attempt.last_outcome_status === 'failed' && !data.update_attempt.last_failure_message) {
      pushError(errors, '$.update_attempt.last_failure_message', 'must be present when last_outcome_status is failed')
    }

    if (data.update_attempt.last_outcome_status === 'succeeded' && data.update_attempt.terminal_failure) {
      pushError(errors, '$.update_attempt.last_outcome_status', 'cannot be succeeded when terminal_failure is true')
    }
  }

  validateWorkflowStepName(data.current_step, '$.current_step', errors)

  for (let index = 0; index < data.steps_completed.length; index++) {
    validateWorkflowStepName(data.steps_completed[index], `$.steps_completed[${index}]`, errors)
  }

  for (let index = 0; index < data.checkpoints.length; index++) {
    validateWorkflowStepName(data.checkpoints[index].step, `$.checkpoints[${index}].step`, errors)
  }

  validateWorkflowStepName(data.resume.resume_from_step, '$.resume.resume_from_step', errors)

  if (data.last_error) {
    validateWorkflowStepName(data.last_error.step, '$.last_error.step', errors)
  }

  validateWorkflowPendingGate(data.pending_gate, errors)

  if (data.resume.resume_count < 0) {
    pushError(errors, '$.resume.resume_count', 'must be >= 0')
  }

  if (data.status === 'waiting' && !data.pending_gate) {
    pushError(errors, '$.pending_gate', 'must be present when status is waiting')
  }

  if (data.status !== 'waiting' && data.pending_gate) {
    pushError(errors, '$.status', 'must equal waiting when pending_gate is present')
  }

  if (data.status === 'completed' && !data.completed_at) {
    pushError(errors, '$.completed_at', 'must be present when status is completed')
  }
}

const SEMANTIC_VALIDATORS = {
  config: () => {},
  analysis: validateAnalysisSemantics,
  'build-result': validateBuildResultSemantics,
  state: validateStateSemantics,
  'workflow-state': validateWorkflowStateSemantics,
}

export function inferArtifactKind(filePath) {
  const baseName = path.basename(filePath)
  switch (baseName) {
    case 'config.json':
      return 'config'
    case 'analysis.json':
      return 'analysis'
    case 'build-result.json':
      return 'build-result'
    case 'state.json':
      return 'state'
    case 'workflow-state.json':
      return 'workflow-state'
    default:
      return null
  }
}

export function validateArtifactData(kind, data) {
  const schema = loadSchema(kind)
  const errors = []

  validateAgainstSchema(schema, data, '$', errors)
  if (errors.length === 0) {
    SEMANTIC_VALIDATORS[kind](data, errors)
  }

  return {
    kind,
    valid: errors.length === 0,
    errors,
  }
}

export function validateArtifactFile(kind, filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  let data
  try {
    data = JSON.parse(raw)
  } catch (error) {
    return {
      kind,
      valid: false,
      errors: [{ path: '$', message: `invalid JSON: ${error.message}` }],
    }
  }

  return validateArtifactData(kind, data)
}
