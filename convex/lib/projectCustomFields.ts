import type {
  ProjectCustomFieldDefinition,
  ProjectCustomFieldType,
} from '../constants'

type ProjectLike = {
  customFields?: ProjectCustomFieldDefinition[] | null
}

type IssueCustomFieldValue = string | number | boolean

function normalizeFieldName(name: string) {
  return name.trim() || 'New Field'
}

function normalizeFieldType(type: string | undefined): ProjectCustomFieldType {
  switch (type) {
    case 'number':
    case 'date':
    case 'checkbox':
    case 'select':
      return type
    case 'text':
    default:
      return 'text'
  }
}

function normalizeFieldOptions(options: string[] | undefined) {
  const seen = new Set<string>()
  return (options ?? [])
    .map((option) => option.trim())
    .filter(Boolean)
    .filter((option) => {
      const normalized = option.toLowerCase()
      if (seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })
}

export function normalizeProjectCustomFields(
  customFields?: ProjectCustomFieldDefinition[] | null,
): ProjectCustomFieldDefinition[] {
  const seenKeys = new Set<string>()
  const seenNames = new Set<string>()

  return (customFields ?? [])
    .map((field) => ({
      key: field.key,
      name: normalizeFieldName(field.name),
      type: normalizeFieldType(field.type),
      position: Number.isFinite(field.position) ? field.position : 0,
      options:
        normalizeFieldType(field.type) === 'select'
          ? normalizeFieldOptions(field.options)
          : undefined,
    }))
    .filter((field) => {
      const normalizedName = field.name.trim().toLowerCase()
      if (!field.key) {
        return false
      }
      if (seenKeys.has(field.key) || seenNames.has(normalizedName)) {
        return false
      }
      seenKeys.add(field.key)
      seenNames.add(normalizedName)
      return true
    })
    .sort((left, right) => left.position - right.position)
    .map((field, index) => ({
      ...field,
      position: index,
    }))
}

export function getProjectCustomField(
  project: ProjectLike | null | undefined,
  fieldKey: string,
) {
  return normalizeProjectCustomFields(project?.customFields).find(
    (field) => field.key === fieldKey,
  )
}

export function normalizeIssueCustomFieldValues(
  customFields: ProjectCustomFieldDefinition[] | null | undefined,
  values: Record<string, IssueCustomFieldValue> | null | undefined,
  options?: { strict?: boolean },
) {
  const strict = options?.strict ?? true
  const normalizedFields = normalizeProjectCustomFields(customFields)
  const fieldByKey = new Map(normalizedFields.map((field) => [field.key, field]))
  const normalizedValues: Record<string, IssueCustomFieldValue> = {}

  for (const [fieldKey, rawValue] of Object.entries(values ?? {})) {
    const field = fieldByKey.get(fieldKey)
    if (!field) {
      if (strict) {
        throw new Error(`Unknown custom field: ${fieldKey}`)
      }
      continue
    }

    switch (field.type) {
      case 'checkbox': {
        if (typeof rawValue === 'boolean') {
          normalizedValues[fieldKey] = rawValue
          continue
        }
        if (rawValue === 'true') {
          normalizedValues[fieldKey] = true
          continue
        }
        if (rawValue === 'false') {
          normalizedValues[fieldKey] = false
          continue
        }
        if (strict) {
          throw new Error(`Field "${field.name}" expects a checkbox value.`)
        }
        continue
      }

      case 'number': {
        const numeric =
          typeof rawValue === 'number'
            ? rawValue
            : Number(String(rawValue).trim())
        if (Number.isFinite(numeric)) {
          normalizedValues[fieldKey] = numeric
          continue
        }
        if (strict) {
          throw new Error(`Field "${field.name}" expects a number.`)
        }
        continue
      }

      case 'date': {
        const value = String(rawValue).trim()
        if (!value) {
          continue
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          normalizedValues[fieldKey] = value
          continue
        }
        if (strict) {
          throw new Error(`Field "${field.name}" expects a date.`)
        }
        continue
      }

      case 'select': {
        const value = String(rawValue).trim()
        if (!value) {
          continue
        }
        if ((field.options ?? []).includes(value)) {
          normalizedValues[fieldKey] = value
          continue
        }
        if (strict) {
          throw new Error(`Field "${field.name}" expects one of its configured options.`)
        }
        continue
      }

      case 'text':
      default: {
        const value = String(rawValue).trim()
        if (value) {
          normalizedValues[fieldKey] = value
        }
        continue
      }
    }
  }

  return normalizedValues
}

export function ensureProjectCustomFieldsExist(
  project: ProjectLike | null | undefined,
  fieldKeys: string[],
) {
  const customFields = normalizeProjectCustomFields(project?.customFields)
  return fieldKeys.every((fieldKey) =>
    customFields.some((field) => field.key === fieldKey),
  )
}
