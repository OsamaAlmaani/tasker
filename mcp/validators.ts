import { z } from 'zod'
import type { GenericValidator } from 'convex/values'

// Derive MCP inputs from the same native validators enforced by the Convex gateway.
export function validatorToZod(value: GenericValidator): z.ZodType {
  let schema: z.ZodType
  switch (value.kind) {
    case 'string':
      schema = z.string()
      break
    case 'id':
      schema = z
        .string()
        .min(1)
        .describe(`Stable ${value.tableName} database ID`)
      break
    case 'float64':
      schema = z.number().finite()
      break
    case 'boolean':
      schema = z.boolean()
      break
    case 'null':
      schema = z.null()
      break
    case 'literal':
      schema = z.literal(value.value as string | number | boolean)
      break
    case 'any':
      schema = z.any()
      break
    case 'array':
      schema = z.array(validatorToZod(value.element))
      break
    case 'union':
      schema = z.union(
        value.members.map(validatorToZod) as [
          z.ZodType,
          z.ZodType,
          ...z.ZodType[],
        ],
      )
      break
    case 'object':
      schema = z
        .object(
          Object.fromEntries(
            Object.entries(
              value.fields as Record<string, GenericValidator>,
            ).map(([key, field]) => [key, validatorToZod(field)]),
          ),
        )
        .strict()
      break
    case 'record':
      schema = z.record(z.string(), validatorToZod(value.value))
      break
    default:
      throw new Error(`Unsupported MCP validator type: ${value.kind}`)
  }
  return value.isOptional === 'optional' ? schema.optional() : schema
}
