// A small YAML reader for GitHub workflow files. It covers what workflows use:
// block mappings and sequences, plain and quoted scalars, block scalars
// (`|`, `>`), flow sequences and flow mappings, and comments. Anchors, tags
// and multiple documents are not supported; their text is kept as strings.

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

type Line = { indent: number; text: string; raw: string }

function stripComment(text: string) {
  let quote: string | null = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === quote) {
        // '' escapes a quote inside single-quoted strings.
        if (quote === "'" && text[index + 1] === "'") index++
        else quote = null
      } else if (char === '\\' && quote === '"') {
        index++
      }
      continue
    }
    if (char === '"' || char === "'") {
      // Quotes only open a string at the start of a value.
      const before = text.slice(0, index).trimEnd()
      if (before === '' || /[:\-[{,]$/.test(before)) quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd()
    }
  }
  return text.trimEnd()
}

function toLines(source: string): Line[] {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((raw) => {
      const indent = raw.length - raw.trimStart().length
      return { indent, raw, text: stripComment(raw.slice(indent)) }
    })
}

function splitFlow(body: string) {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null
      current += char
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') depth--
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Finds the `:` that separates a mapping key from its value, outside quotes. */
function findKeySeparator(text: string) {
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0]
    let index = 1
    while (index < text.length) {
      if (text[index] === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          index += 2
          continue
        }
        break
      }
      if (text[index] === '\\' && quote === '"') index++
      index++
    }
    const after = text.indexOf(':', index)
    return after !== -1 && (after + 1 === text.length || text[after + 1] === ' ') ? after : -1
  }
  if (text.startsWith('[') || text.startsWith('{')) return -1
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ':' && (index + 1 === text.length || text[index + 1] === ' ')) return index
  }
  return -1
}

function unquote(text: string) {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\(["\\/nrt])/g, (_, char: string) =>
        char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char,
      )
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return null
}

export function parseScalar(text: string): YamlValue {
  const trimmed = text.trim()
  const quoted = unquote(trimmed)
  if (quoted !== null) return quoted
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitFlow(trimmed.slice(1, -1)).map(parseScalar)
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const result: Record<string, YamlValue> = {}
    for (const part of splitFlow(trimmed.slice(1, -1))) {
      const separator = findKeySeparator(part)
      if (separator === -1) result[keyText(part)] = null
      else result[keyText(part.slice(0, separator))] = parseScalar(part.slice(separator + 1))
    }
    return result
  }
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

function keyText(text: string) {
  const trimmed = text.trim()
  return unquote(trimmed) ?? trimmed
}

class Parser {
  private index = 0

  constructor(private readonly lines: Line[]) {}

  private skipBlank() {
    while (this.index < this.lines.length && this.lines[this.index].text === '') this.index++
  }

  private peek() {
    this.skipBlank()
    return this.index < this.lines.length ? this.lines[this.index] : null
  }

  parseDocument(): YamlValue {
    const first = this.peek()
    if (!first) return null
    return this.parseBlock(first.indent)
  }

  /** Parses the node starting at the next line, which sits at `indent`. */
  private parseBlock(indent: number): YamlValue {
    const line = this.peek()
    if (!line || line.indent < indent) return null
    if (line.text === '-' || line.text.startsWith('- ')) return this.parseSequence(line.indent)
    if (findKeySeparator(line.text) !== -1) return this.parseMapping(line.indent)
    this.index++
    return parseScalar(line.text)
  }

  private parseSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = []
    while (true) {
      const line = this.peek()
      if (!line || line.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) break
      const rest = line.text === '-' ? '' : line.text.slice(2).trimStart()
      if (rest === '') {
        this.index++
        const next = this.peek()
        items.push(next && next.indent > indent ? this.parseBlock(next.indent) : null)
        continue
      }
      // "- key: value" starts a mapping at the key's column; rewrite the line
      // so the mapping parser sees the key at that indent.
      const offset = line.text.length - rest.length
      if (findKeySeparator(rest) !== -1 || rest.startsWith('- ')) {
        this.lines[this.index] = { indent: indent + offset, text: rest, raw: line.raw }
        items.push(this.parseBlock(indent + offset))
        continue
      }
      this.index++
      items.push(this.parseInlineValue(rest, indent))
    }
    return items
  }

  private parseMapping(indent: number): Record<string, YamlValue> {
    const result: Record<string, YamlValue> = {}
    while (true) {
      const line = this.peek()
      if (!line || line.indent !== indent) break
      if (line.text === '-' || line.text.startsWith('- ')) break
      const separator = findKeySeparator(line.text)
      if (separator === -1) break
      const key = keyText(line.text.slice(0, separator))
      const rest = line.text.slice(separator + 1).trim()
      this.index++
      if (rest === '') {
        const next = this.peek()
        if (next && next.indent > indent) result[key] = this.parseBlock(next.indent)
        else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- ')))
          result[key] = this.parseSequence(indent)
        else result[key] = null
        continue
      }
      result[key] = this.parseInlineValue(rest, indent)
    }
    return result
  }

  /** A value written after `key:` or `- `, which may start a block scalar. */
  private parseInlineValue(rest: string, parentIndent: number): YamlValue {
    const blockScalar = rest.match(/^([|>])([+-]?)(\d*)\s*$/)
    if (blockScalar) return this.parseBlockScalar(parentIndent, blockScalar[1] === '>', blockScalar[2])
    // Anchors and tags are not resolved; drop the marker and keep the value.
    return parseScalar(rest.replace(/^(&\S+|!\S+)\s*/, ''))
  }

  private parseBlockScalar(parentIndent: number, folded: boolean, chomping: string) {
    const collected: string[] = []
    let blockIndent: number | null = null
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      const isBlank = line.raw.trim() === ''
      if (!isBlank && line.indent <= parentIndent) break
      if (!isBlank && blockIndent === null) blockIndent = line.indent
      collected.push(isBlank ? '' : line.raw.slice(blockIndent ?? line.indent))
      this.index++
    }
    while (collected.length && collected[collected.length - 1] === '') collected.pop()
    const text = folded
      ? collected.reduce((joined, line, index) => {
          if (index === 0) return line
          return line === '' ? `${joined}\n` : joined.endsWith('\n') ? `${joined}${line}` : `${joined} ${line}`
        }, '')
      : collected.join('\n')
    return chomping === '-' ? text : `${text}\n`
  }
}

/** Parses YAML text. Returns null for empty documents; never throws on odd input. */
export function parseYaml(source: string): YamlValue {
  try {
    return new Parser(toLines(source)).parseDocument()
  } catch {
    return null
  }
}

export function asRecord(value: YamlValue | undefined): Record<string, YamlValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function asArray(value: YamlValue | undefined): YamlValue[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: YamlValue | undefined): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}
