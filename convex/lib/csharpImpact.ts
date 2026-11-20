// Name-level impact analysis for C# repositories ("deep analysis").
//
// The folder rules in workflowImpact.ts say a service is affected whenever
// any project it references changes. Deep analysis narrows that down: a
// change in a referenced library only counts when the service's own code
// can reach a changed type by name, directly or through other library code.
//
// It is deliberately a name-based heuristic, not a compiler. Everything it
// is unsure about counts as affected:
// - non-C# files, migrations, project files and the service's own project
//   always count;
// - types that frameworks discover by reflection (hosted services,
//   controllers, message consumers, DI installers, ...) count whenever they
//   change or reach a changed name, including custom conventions found in
//   the repository's own scanning code (`typeof(X).IsAssignableFrom`, ...);
// - name collisions only ever add matches.
// The few types that frameworks discover but only run when code asks for
// the types they name (AutoMapper profiles, FluentValidation validators, EF
// Core entity configurations) are followed by name like ordinary code,
// unless the repository validates AutoMapper configuration at startup.

import type { SourceScope } from './workflowImpact'

/** Bump when the index format or parsing changes; older cache entries are then ignored. */
export const CSHARP_INDEX_VERSION = 1

export type CsharpFileIndex = {
  /** Types, extension methods and attribute short names the file declares. */
  declared: string[]
  /** Distinct identifiers used anywhere in the file (strings included), keywords removed. */
  tokens: string[]
  /** Outer names of the base types and interfaces of the declared types. */
  bases: string[]
  /** Attributes on the declared types, without the `Attribute` suffix. */
  attributes: string[]
  /** Base types this file finds by reflection, which makes them framework-discovered. */
  scanBases: string[]
  /** Attributes this file finds by reflection. */
  scanAttributes: string[]
  /** Behaviour switches found in the file, such as AutoMapper configuration validation. */
  flags: string[]
  /** True when the file declares an EF Core DbContext. */
  dbContext: boolean
  /**
   * Members of a file holding exactly one static class or one DbContext:
   * [names the member declares, identifiers it uses, a name callers must
   * also use]. Lets a reached hub forward only the members that use a
   * changed name. Callers of a static class's ordinary members write
   * `ClassName.Member`, so those members carry the class name; extension
   * methods and DbContext members carry null.
   */
  members: Array<[string[], string[], string | null]> | null
  /**
   * AutoMapper `CreateMap` statements: [the mapped source and destination
   * types, identifiers the statement uses].
   */
  mapSegments: Array<[string[], string[]]> | null
  /** Types a validator or entity configuration is for: `AbstractValidator<T>` -> T. */
  targets: string[]
}

// ---------------------------------------------------------------------------
// Paths

export function isCsharpSource(path: string) {
  return /\.cs$/i.test(path)
}

/** EF Core migrations are found by reflection and never named; their (large) text is not indexed. */
export function isMigrationSource(path: string) {
  return /(^|\/)Migrations\//i.test(path)
}

export function isTracedSource(path: string) {
  return isCsharpSource(path) && !isMigrationSource(path)
}

// ---------------------------------------------------------------------------
// Lexing

/**
 * Splits C# text into two views of the same length as the input:
 * `code` has comments blanked; `structure` also blanks string and character
 * literals (including interpolation holes), so braces and keywords in it
 * are real code. Newlines are kept so offsets line up.
 */
export function lexCsharp(text: string): { code: string; structure: string } {
  const code = text.split('')
  const structure = text.split('')
  const length = text.length

  const blank = (from: number, to: number, both: boolean) => {
    for (let index = from; index < to && index < length; index++) {
      if (text[index] === '\n' || text[index] === '\r') continue
      structure[index] = ' '
      if (both) code[index] = ' '
    }
  }

  // Lexes code from `start`. With `inHole`, stops at the `}` that closes an
  // interpolation hole and returns its index; structure output is blanked.
  function lexCode(start: number, inHole: boolean): number {
    let index = start
    let depth = 0
    while (index < length) {
      const char = text[index]
      const next = text[index + 1]
      if (char === '/' && next === '/') {
        const end = text.indexOf('\n', index)
        const stop = end === -1 ? length : end
        blank(index, stop, true)
        index = stop
        continue
      }
      if (char === '/' && next === '*') {
        const end = text.indexOf('*/', index + 2)
        const stop = end === -1 ? length : end + 2
        blank(index, stop, true)
        index = stop
        continue
      }
      if (char === "'") {
        index = lexChar(index)
        continue
      }
      if (char === '"' || ((char === '$' || char === '@') && stringStartsAt(index))) {
        index = lexString(index)
        continue
      }
      if (inHole) {
        if (char === '{') depth++
        else if (char === '}') {
          if (depth === 0) return index
          depth--
        }
        blank(index, index + 1, false)
      }
      index++
    }
    return index
  }

  function stringStartsAt(index: number) {
    let cursor = index
    while (text[cursor] === '$' || text[cursor] === '@') cursor++
    return text[cursor] === '"' && cursor > index
  }

  function lexChar(start: number) {
    let index = start + 1
    if (text[index] === '\\') index += 2
    else index += 1
    // Escapes such as 'A' run longer; find the closing quote nearby.
    const close = text.indexOf("'", index)
    const stop = close !== -1 && close - start <= 12 ? close + 1 : start + 1
    blank(start, stop, false)
    return stop
  }

  function lexString(start: number) {
    let index = start
    let dollars = 0
    let verbatim = false
    while (text[index] === '$' || text[index] === '@') {
      if (text[index] === '$') dollars++
      else verbatim = true
      index++
    }
    let quotes = 0
    while (text[index + quotes] === '"') quotes++
    blank(start, index + Math.min(quotes, 3), false)

    if (quotes >= 3) {
      // Raw string literal: ends at the same number of quotes; holes open with `dollars` braces.
      let cursor = index + quotes
      while (cursor < length) {
        if (text[cursor] === '"') {
          let run = 0
          while (text[cursor + run] === '"') run++
          if (run >= quotes) {
            blank(cursor, cursor + run, false)
            return cursor + run
          }
          blank(cursor, cursor + run, false)
          cursor += run
          continue
        }
        if (dollars > 0 && text[cursor] === '{') {
          let run = 0
          while (text[cursor + run] === '{') run++
          if (run >= dollars) {
            blank(cursor, cursor + run, false)
            const close = lexCode(cursor + run, true)
            let closeRun = 0
            while (text[close + closeRun] === '}' && closeRun < dollars) closeRun++
            blank(close, close + closeRun, false)
            cursor = close + Math.max(closeRun, 1)
            continue
          }
          blank(cursor, cursor + run, false)
          cursor += run
          continue
        }
        blank(cursor, cursor + 1, false)
        cursor++
      }
      return length
    }

    if (quotes === 2) {
      // Empty string "".
      blank(index, index + 2, false)
      return index + 2
    }

    let cursor = index + 1
    while (cursor < length) {
      const char = text[cursor]
      if (!verbatim && char === '\\') {
        blank(cursor, cursor + 2, false)
        cursor += 2
        continue
      }
      if (char === '"') {
        if (verbatim && text[cursor + 1] === '"') {
          blank(cursor, cursor + 2, false)
          cursor += 2
          continue
        }
        blank(cursor, cursor + 1, false)
        return cursor + 1
      }
      if (!verbatim && char === '\n') return cursor
      if (dollars > 0 && char === '{') {
        if (text[cursor + 1] === '{') {
          blank(cursor, cursor + 2, false)
          cursor += 2
          continue
        }
        blank(cursor, cursor + 1, false)
        const close = lexCode(cursor + 1, true)
        blank(close, close + 1, false)
        cursor = close + 1
        continue
      }
      blank(cursor, cursor + 1, false)
      cursor++
    }
    return length
  }

  lexCode(0, false)
  return { code: code.join(''), structure: structure.join('') }
}

// ---------------------------------------------------------------------------
// Indexing

const KEYWORDS = new Set(
  (
    'abstract as base bool break byte case catch char checked class const continue decimal default delegate do ' +
    'double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface ' +
    'internal is lock long namespace new null object operator out override params private protected public readonly ' +
    'ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ' +
    'ulong unchecked unsafe ushort using virtual void volatile while add alias and ascending async await by ' +
    'descending dynamic equals from get global group init into join let managed nameof nint not notnull nuint on ' +
    'or orderby partial record remove required scoped select set unmanaged value var when where with yield file ' +
    'field extension'
  ).split(' '),
)

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g

/** Outer type name of a base-list entry: `Ns.Repo<T>(arg)` -> `Repo`. */
function outerName(entry: string) {
  const withoutArgs = stripBalanced(stripBalanced(entry, '<', '>'), '(', ')').trim()
  const last = withoutArgs.split('.').pop()?.trim() ?? ''
  return /^@?[A-Za-z_]\w*$/.test(last) ? last.replace(/^@/, '') : null
}

function stripBalanced(text: string, open: string, close: string) {
  let depth = 0
  let result = ''
  for (const char of text) {
    if (char === open) depth++
    else if (char === close) depth = Math.max(0, depth - 1)
    else if (depth === 0) result += char
  }
  return result
}

function splitTopLevel(text: string, separator: string) {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '<' || char === '(' || char === '[') depth++
    else if (char === '>' || char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

function attributeNames(section: string) {
  const names: string[] = []
  for (const match of section.matchAll(/\[([^[\]]*)\]/g)) {
    const content = match[1].trim()
    if (/^\w+\s*:/.test(content)) continue // [assembly: ...], [return: ...]
    for (const part of splitTopLevel(content, ',')) {
      const name = outerName(part)
      if (name) names.push(name.replace(/Attribute$/, ''))
    }
  }
  return names
}

type TypeDeclaration = {
  keyword: string
  name: string
  /** Index of the name in the text. */
  at: number
  /** Index just past the opening `{`, or -1 for declarations without a body. */
  bodyStart: number
  modifiers: string
  bases: string[]
  /** Base-list entries as written, generic arguments included. */
  baseEntries: string[]
}

const TYPE_DECLARATION =
  /\b(class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?@?([A-Za-z_]\w*)/g

function findTypes(structure: string): TypeDeclaration[] {
  const types: TypeDeclaration[] = []
  for (const match of structure.matchAll(TYPE_DECLARATION)) {
    const at = (match.index ?? 0) + match[0].length - match[2].length
    // `where T : class` and `class` used as a constraint are not declarations.
    const before = structure.slice(Math.max(0, (match.index ?? 0) - 40), match.index)
    if (/[:,]\s*$/.test(before) || /\bwhere\s+\w+\s*:\s*$/.test(before)) continue
    let cursor = at + match[2].length
    let depth = 0
    while (cursor < structure.length) {
      const char = structure[cursor]
      if (char === '(' || char === '<') depth++
      else if (char === ')' || char === '>') depth = Math.max(0, depth - 1)
      else if (depth === 0 && (char === '{' || char === ';')) break
      cursor++
    }
    const header = structure.slice(at + match[2].length, cursor)
    const headerNoArgs = stripBalanced(header, '(', ')')
    const colon = headerNoArgs.indexOf(':')
    const baseText = colon === -1 ? '' : headerNoArgs.slice(colon + 1).split(/\bwhere\b/)[0]
    const baseEntries = baseText ? splitTopLevel(baseText, ',') : []
    const bases = baseEntries.map(outerName).filter((name): name is string => Boolean(name))
    const lineStart = structure.lastIndexOf('\n', match.index ?? 0) + 1
    types.push({
      keyword: match[1],
      name: match[2],
      at,
      bodyStart: structure[cursor] === '{' ? cursor + 1 : -1,
      modifiers: structure.slice(lineStart, match.index),
      bases,
      baseEntries,
    })
  }
  return types
}

/** Member spans of a type body: [start, end) offsets, split at depth-0 `;` and closing `}`. */
function memberSpans(structure: string, bodyStart: number) {
  const spans: Array<[number, number]> = []
  let depth = 0
  let start = bodyStart
  for (let index = bodyStart; index < structure.length; index++) {
    const char = structure[index]
    if (char === '{') depth++
    else if (char === '}') {
      if (depth === 0) break
      depth--
      if (depth === 0) {
        // `= new() { ... };` and `{ get; } = x;` continue to the semicolon.
        const rest = structure.slice(index + 1).match(/^\s*(=|;)/)
        if (rest?.[1] === '=') continue
        spans.push([start, index + 1])
        start = index + 1
      }
    } else if (char === ';' && depth === 0) {
      spans.push([start, index + 1])
      start = index + 1
    }
  }
  return spans.filter(([from, to]) => structure.slice(from, to).trim().length > 1)
}

/**
 * The member declaration header: text before the first top-level body,
 * initializer or terminator (a brace, `=`, `=>` or `;`), attributes removed.
 */
function memberHeader(structureSpan: string) {
  const text = structureSpan.replace(/^\s*(\[[^\]]*\]\s*)+/, '')
  let depth = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '(' || char === '<' || char === '[') depth++
    else if (char === ')' || char === '>' || char === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === '{' || char === ';' || (char === '=' && text[index + 1] !== '='))) {
      return text.slice(0, index)
    }
  }
  return text
}

/**
 * Names one member declares and whether it is an extension method. A method
 * name is the first non-keyword identifier followed by its parameter list,
 * so tuple return types such as `(int A, bool B) Get(...)` are skipped.
 */
function memberSignature(structureSpan: string): { names: string[]; extension: boolean } {
  const header = memberHeader(structureSpan)
  for (const match of header.matchAll(/@?([A-Za-z_]\w*)\s*(?:<[^()]*?>)?\s*\(/g)) {
    if (KEYWORDS.has(match[1])) continue
    const params = header.slice((match.index ?? 0) + match[0].length)
    return { names: [match[1]], extension: /^\s*this\s/.test(params) }
  }
  const own = header.trim().match(/@?([A-Za-z_]\w*)\s*(?:<[^>]*>)?$/)?.[1]
  const names = own && !KEYWORDS.has(own) ? [own] : []
  // `public const int A = 1, B = 2;`
  if (/;\s*$/.test(structureSpan)) {
    for (const match of stripBalanced(structureSpan, '(', ')').matchAll(/,\s*@?([A-Za-z_]\w*)\s*(?==|,|;)/g)) {
      names.push(match[1])
    }
  }
  return { names, extension: false }
}

/** Names one member declares: its own name, plus every declarator of a multi-field declaration. */
function memberNames(structureSpan: string) {
  return memberSignature(structureSpan).names
}

function identifiers(text: string) {
  const result = new Set<string>()
  for (const token of text.match(IDENTIFIER) ?? []) if (!KEYWORDS.has(token)) result.add(token)
  return result
}

const SCAN_BASE_PATTERNS = [
  /typeof\(\s*(?:[\w.]+\.)?(\w+)\s*(?:<[\s,]*>)?\s*\)\s*\.\s*IsAssignableFrom\b/g,
  /\bIsAssignableTo\(\s*typeof\(\s*(?:[\w.]+\.)?(\w+)/g,
  /\bIsSubclassOf\(\s*typeof\(\s*(?:[\w.]+\.)?(\w+)/g,
  /==\s*typeof\(\s*(?:[\w.]+\.)?(\w+)\s*<[\s,]*>\s*\)/g,
  /typeof\(\s*(?:[\w.]+\.)?(\w+)\s*<[\s,]*>\s*\)\s*==/g,
  /\bAssignableTo(?:Any)?\s*<\s*(?:[\w.]+\.)?(\w+)/g,
  /\bAssignableTo(?:Any)?\s*\(\s*typeof\(\s*(?:[\w.]+\.)?(\w+)/g,
  /\bGetInterface\(\s*(?:nameof\(\s*)?"?(?:[\w.]+\.)?(\w+)/g,
]

const SCAN_ATTRIBUTE_PATTERNS = [
  /\bGetCustomAttributes?\s*<\s*(?:[\w.]+\.)?(\w+)\s*>/g,
  /(?<!Enum\.)\b(?:GetCustomAttributes?|IsDefined)\s*\(\s*typeof\(\s*(?:[\w.]+\.)?(\w+)/g,
]

/** Code that lists an assembly's types, which is what turns a type test into discovery. */
const TYPE_LISTING =
  /\b(?:GetTypes|GetExportedTypes|ExportedTypes|DefinedTypes|GetLoadableTypes|AddClasses|FromAssembl\w*|FromApplicationDependencies)\b/g
const SCAN_WINDOW = 600

const TYPE_ATTRIBUTES =
  /((?:\[[^[\]]*\]\s*)+)(?:(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|file|unsafe|new|ref)\s+)*(?:class|struct|interface|record|enum)\s/g

export function indexCsharpFile(text: string): CsharpFileIndex {
  const { code, structure } = lexCsharp(text)
  const types = findTypes(structure)
  const declared = new Set<string>()
  const bases = new Set<string>()
  for (const type of types) {
    declared.add(type.name)
    if (type.name.endsWith('Attribute') && type.name.length > 'Attribute'.length) {
      declared.add(type.name.slice(0, -'Attribute'.length))
    }
    for (const base of type.bases) bases.add(base)
  }
  for (const match of structure.matchAll(/\bdelegate\s+[\w<>[\],.?\s]+?\s@?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g)) {
    declared.add(match[1])
  }
  // Extension methods are called by method name, not by their class name. Only
  // declarations put `this` before the first parameter's type.
  for (const match of structure.matchAll(/@?([A-Za-z_]\w*)\s*(?:<[^()]*?>)?\s*\(\s*this\s+[A-Za-z_(]/g)) {
    if (!KEYWORDS.has(match[1])) declared.add(match[1])
  }
  // C# 14 extension blocks: every member inside is called by its own name.
  if (/\bextension\s*(?:<[^>]*>)?\s*\(/.test(structure)) {
    for (const match of structure.matchAll(
      /\b(?:public|internal)\s+[^;{}()=]*?\s@?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*[({=]/g,
    )) {
      declared.add(match[1])
    }
  }

  const attributes = new Set<string>()
  for (const match of structure.matchAll(TYPE_ATTRIBUTES)) {
    for (const name of attributeNames(match[1])) attributes.add(name)
  }

  // Only checks next to an assembly type listing are discovery; elsewhere
  // `typeof(X).IsAssignableFrom(obj.GetType())` is an ordinary type test.
  const listings = [...code.matchAll(TYPE_LISTING)].map((match) => match.index ?? 0)
  const nearListing = (at: number) => listings.some((listing) => Math.abs(listing - at) <= SCAN_WINDOW)
  const scanBases = new Set<string>()
  for (const pattern of SCAN_BASE_PATTERNS) {
    for (const match of code.matchAll(pattern)) if (nearListing(match.index ?? 0)) scanBases.add(match[1])
  }
  const scanAttributes = new Set<string>()
  for (const pattern of SCAN_ATTRIBUTE_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      if (nearListing(match.index ?? 0)) scanAttributes.add(match[1].replace(/Attribute$/, ''))
    }
  }

  const flags: string[] = []
  if (/\bAssertConfigurationIsValid\b/.test(code)) flags.push('automapper-validates')

  const dbContext = types.some((type) => type.bases.some((base) => /DbContext$/.test(base)))
  let members: CsharpFileIndex['members'] = null
  const outerTypes = types.filter((type) => !types.some((other) => other !== type && contains(structure, other, type)))
  if (outerTypes.length === 1 && outerTypes[0].bodyStart !== -1) {
    const only = outerTypes[0]
    const isStatic = only.keyword === 'class' && /\bstatic\b/.test(only.modifiers)
    if (isStatic || dbContext) {
      members = memberSpans(structure, only.bodyStart).map(([from, to]) => {
        const span = structure.slice(from, to)
        return [
          memberNames(span),
          [...identifiers(code.slice(from, to))],
          isStatic && !isExtensionMember(span) ? only.name : null,
        ]
      })
    }
  }

  const segments = mapStatements(code)
  const targets = new Set<string>()
  for (const type of types) {
    for (const entry of type.baseEntries) {
      if (!TARGET_BASES.has(outerName(entry) ?? '')) continue
      for (const name of identifiers(entry.slice(entry.indexOf('<') + 1))) targets.add(name)
    }
  }
  return {
    declared: [...declared],
    tokens: [...identifiers(code)],
    bases: [...bases],
    attributes: [...attributes],
    scanBases: [...scanBases],
    scanAttributes: [...scanAttributes],
    flags,
    dbContext,
    members,
    mapSegments: segments.statements.length
      ? segments.statements.map((segment) => [mappedTypes(segment), [...identifiers(segment)]])
      : null,
    targets: [...targets],
  }
}

/** Text before the first AutoMapper `CreateMap` call, and of each call up to the next one. */
function mapStatements(code: string) {
  const starts = [...code.matchAll(/\b(?:CreateMap|CreateProjection)\s*</g)].map((match) => match.index ?? 0)
  const prefix = starts.length ? code.slice(0, starts[0]) : code
  return {
    // Usings and namespaces do not change how maps behave.
    prefix: prefix
      .replace(/\b(?:global\s+)?using\s+(?:static\s+)?[\w.]+\s*(?:=\s*[\w.<>,\s]+)?;/g, '')
      .replace(/\bnamespace\s+[\w.]+\s*[;{]?/g, ''),
    statements: starts.map((start, index) => code.slice(start, starts[index + 1] ?? code.length)),
  }
}

/** Source and destination types of a `CreateMap<Source, Destination>` statement. */
function mappedTypes(statement: string) {
  const args = statement.match(/^(?:CreateMap|CreateProjection)\s*<([\s\S]*?)>\s*\(/)?.[1] ?? ''
  return [...identifiers(args)]
}

/** Types whose mapping changed: the source and destination of each changed statement. */
export function changedMappedTypes(before: string | null, after: string | null): string[] | null {
  const statements = changedMapStatements(before, after)
  return statements ? [...new Set(statements.flatMap(mappedTypes))] : null
}

/**
 * `CreateMap` statements that differ between two versions, or null when
 * neither version declares maps. A change before the first map (profile
 * settings such as `AllowNullCollections`) returns every statement.
 */
export function changedMapStatements(before: string | null, after: string | null): string[] | null {
  const read = (text: string | null) => {
    const parts = mapStatements(text ? lexCsharp(text).code : '')
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
    return { prefix: normalize(parts.prefix), statements: parts.statements.map(normalize) }
  }
  const old = read(before)
  const now = read(after)
  if (!old.statements.length && !now.statements.length) return null
  if (old.prefix !== now.prefix) return [...old.statements, ...now.statements]
  const oldSet = new Set(old.statements)
  const nowSet = new Set(now.statements)
  return [
    ...now.statements.filter((segment) => !oldSet.has(segment)),
    ...old.statements.filter((segment) => !nowSet.has(segment)),
  ]
}

/** An extension method: its first parameter is `this T`, so callers never write the class name. */
function isExtensionMember(structureSpan: string) {
  return memberSignature(structureSpan).extension
}

/** True when `inner` is declared inside `outer`'s body. */
function contains(structure: string, outer: TypeDeclaration, inner: TypeDeclaration) {
  if (outer.bodyStart === -1 || inner.at < outer.bodyStart) return false
  let depth = 0
  for (let index = outer.bodyStart; index < inner.at; index++) {
    if (structure[index] === '{') depth++
    else if (structure[index] === '}') {
      if (depth === 0) return false
      depth--
    }
  }
  return true
}

/**
 * Member text of a file holding exactly one static class or one DbContext,
 * keyed by member name (overloads collected together). Returns null for any
 * other shape. Member text keeps string literals, so a changed constant
 * value counts.
 */
export function classMembers(text: string): {
  className: string
  /** Interfaces the class implements, by convention names starting with `I`. */
  interfaces: string[]
  kind: 'static' | 'dbContext'
  members: Map<string, { texts: string[]; extension: boolean; tokens: Set<string> }>
} | null {
  const { code, structure } = lexCsharp(text)
  const types = findTypes(structure)
  const outer = types.filter((type) => !types.some((other) => other !== type && contains(structure, other, type)))
  if (outer.length !== 1) return null
  const only = outer[0]
  if (only.keyword !== 'class' || only.bodyStart === -1) return null
  const kind = /\bstatic\b/.test(only.modifiers)
    ? 'static'
    : only.bases.some((base) => /DbContext$/.test(base))
      ? 'dbContext'
      : null
  if (!kind) return null
  const members = new Map<string, { texts: string[]; extension: boolean; tokens: Set<string> }>()
  for (const [from, to] of memberSpans(structure, only.bodyStart)) {
    const span = structure.slice(from, to)
    const memberCode = code.slice(from, to)
    const normalized = memberCode.replace(/\s+/g, ' ').trim()
    const extension = isExtensionMember(span)
    for (const name of memberNames(span)) {
      const entry = members.get(name) ?? { texts: [], extension: false, tokens: new Set<string>() }
      entry.texts.push(normalized)
      entry.extension ||= extension
      for (const token of identifiers(memberCode)) entry.tokens.add(token)
      members.set(name, entry)
    }
  }
  return {
    className: only.name,
    interfaces: only.bases.filter((base) => /^I[A-Z]/.test(base)),
    kind,
    members,
  }
}

/**
 * A changed name, and a name callers must also use (`ClassName` for
 * `ClassName.Member`; `A|B` for either), or MAPS for types whose AutoMapper
 * mapping changed: only code that runs mappings is affected by those.
 */
export type ChangedName = { name: string; requires: string | null }

/** `requires` value for types whose mapping changed. */
export const MAPS = '@maps'

/** Identifiers that show a file runs AutoMapper mappings (an injected or inherited mapper, projections). */
function runsMappings(tokens: Set<string>) {
  for (const token of tokens) if (/mapper/i.test(token) || token === 'ProjectTo' || token === 'MapTo') return true
  return false
}

/**
 * Members whose text differs between two versions of a static class or a
 * DbContext, or null for any other shape. A changed DbContext member also
 * changes the entities it names (`DbSet<Entity>`, `modelBuilder.Entity<X>()`),
 * so those are included; `declared` limits them to the repository's types.
 */
export function changedClassMembers(before: string, after: string, declared: Set<string>): ChangedName[] | null {
  const old = classMembers(before)
  const now = classMembers(after)
  if (!old || !now || old.kind !== now.kind) return null
  const changed: ChangedName[] = []
  const renamed = old.className !== now.className
  for (const name of new Set([...old.members.keys(), ...now.members.keys()])) {
    const a = old.members.get(name)
    const b = now.members.get(name)
    if ((a?.texts ?? []).slice().sort().join('\n') === (b?.texts ?? []).slice().sort().join('\n')) continue
    if (now.kind === 'dbContext') {
      changed.push({ name, requires: null })
      // A model change matters only to queries through this context (or its interface).
      const context = [now.className, ...now.interfaces].join('|')
      for (const token of new Set([...(a?.tokens ?? []), ...(b?.tokens ?? [])])) {
        if (declared.has(token) && token !== now.className) changed.push({ name: token, requires: context })
      }
      continue
    }
    const extension = Boolean(a?.extension || b?.extension)
    // A renamed class changes every caller, so require neither name in that case.
    changed.push({ name, requires: extension || renamed ? null : now.className })
  }
  if (renamed) changed.push({ name: old.className, requires: null })
  return changed
}

// ---------------------------------------------------------------------------
// Graph and tracing

/** Base types and interfaces that well-known frameworks find by reflection. */
const FRAMEWORK_DISCOVERED = [
  'Profile', // AutoMapper
  'AbstractValidator', // FluentValidation
  'IEntityTypeConfiguration', // EF Core
  'Migration',
  'ModelSnapshot',
  'ControllerBase', // ASP.NET Core
  'Controller',
  'Hub', // SignalR
  'BackgroundService', // hosting
  'IHostedService',
  'IHostedLifecycleService',
  'IStartupFilter',
  'IMiddleware',
  'IConsumer', // MassTransit
  'IRequestHandler', // MediatR
  'INotificationHandler',
  'IPipelineBehavior',
  'IJob', // Quartz
]

/** Bases whose generic argument is the type a validator or entity configuration is for. */
const TARGET_BASES = new Set(['AbstractValidator', 'InlineValidator', 'IEntityTypeConfiguration'])

/** Discovered types that only run when code asks for the types they name. */
const ON_DEMAND = ['Profile', 'AbstractValidator', 'IEntityTypeConfiguration']

export type SymbolGraph = {
  files: Map<string, CsharpFileIndex>
  /** Every name declared by an indexed file. */
  declared: Set<string>
  /** Name -> files that use it. */
  mentions: Map<string, string[]>
  discoveredBases: Set<string>
  discoveredAttributes: Set<string>
  onDemand: Set<string>
  /** Traced sources in scope that could not be read. */
  unreadable: Set<string>
}

export function buildSymbolGraph(files: Map<string, CsharpFileIndex>, unreadable: Iterable<string> = []): SymbolGraph {
  const declaredAnywhere = new Set<string>()
  const discoveredBases = new Set(FRAMEWORK_DISCOVERED)
  const discoveredAttributes = new Set<string>()
  const onDemand = new Set(ON_DEMAND)
  for (const index of files.values()) {
    for (const name of index.declared) declaredAnywhere.add(name)
    for (const member of index.members ?? []) for (const name of member[0]) declaredAnywhere.add(name)
    for (const name of index.scanBases) discoveredBases.add(name)
    for (const name of index.scanAttributes) discoveredAttributes.add(name)
    if (index.flags.includes('automapper-validates')) onDemand.delete('Profile')
  }
  const mentions = new Map<string, string[]>()
  for (const [path, index] of files) {
    for (const token of index.tokens) {
      if (!declaredAnywhere.has(token)) continue
      const list = mentions.get(token)
      if (list) list.push(path)
      else mentions.set(token, [path])
    }
  }
  return {
    files,
    declared: declaredAnywhere,
    mentions,
    discoveredBases,
    discoveredAttributes,
    onDemand,
    unreadable: new Set(unreadable),
  }
}

export type { SourceScope }

/** A version of a changed file: its text, `'unreadable'`, or null when it did not exist. */
export type SourceVersion = string | 'unreadable' | null

export type ChangedSource = {
  path: string
  previousPath: string | null
  before: SourceVersion
  after: SourceVersion
}

export type TraceResult =
  | { affected: true; reason: string; path: string | null }
  | { affected: false; traced: string[] }

function scopeOf(scopes: SourceScope[], path: string) {
  let best: SourceScope | null = null
  for (const scope of scopes) {
    const matches = scope.kind === 'file' ? scope.path === path : scope.path === '' || path.startsWith(`${scope.path}/`)
    if (!matches) continue
    if (!best || (scope.kind === 'file' && best.kind !== 'file') || scope.path.length > best.path.length) best = scope
  }
  return best
}

function discoveredKind(graph: SymbolGraph, index: CsharpFileIndex | null) {
  if (!index) return null
  for (const base of index.bases) if (graph.discoveredBases.has(base)) return base
  for (const attribute of index.attributes) if (graph.discoveredAttributes.has(attribute)) return `[${attribute}]`
  return null
}

const isOnDemand = (graph: SymbolGraph, kind: string) => !kind.startsWith('[') && graph.onDemand.has(kind)

const kindLabel = (kind: string) => (kind.startsWith('[') ? `a type marked ${kind}` : `a ${kind} type`)

/**
 * Decides whether changes in a workflow's referenced projects reach its own
 * code. `changes` are the changed files the folder rules matched for it.
 */
export function traceImpact({
  graph,
  scopes,
  changes,
}: {
  graph: SymbolGraph
  scopes: SourceScope[]
  changes: ChangedSource[]
}): TraceResult {
  for (const path of graph.unreadable) {
    if (scopeOf(scopes, path)) return { affected: true, reason: `Tasker could not read ${path}.`, path }
  }
  const seeds = new Map<string, ChangedName>()
  const seed = (name: string, requires: string | null = null) => {
    const key = `${name}|${requires ?? ''}`
    if (!seeds.has(key)) seeds.set(key, { name, requires })
  }
  for (const change of changes) {
    const { path } = change
    if (!isCsharpSource(path)) return { affected: true, reason: `${path} is not C# code.`, path }
    const scope = scopeOf(scopes, path) ?? (change.previousPath ? scopeOf(scopes, change.previousPath) : null)
    if (!scope) return { affected: true, reason: `${path} is a build input.`, path }
    if (scope.root) return { affected: true, reason: `${path} is part of its own project.`, path }
    if (isMigrationSource(path)) return { affected: true, reason: `${path} is a migration.`, path }
    if (change.before === 'unreadable' || change.after === 'unreadable') {
      return { affected: true, reason: `Tasker could not read ${path}.`, path }
    }
    const before = change.before === null ? null : indexCsharpFile(change.before)
    const after = change.after === null ? null : indexCsharpFile(change.after)
    const kind = discoveredKind(graph, after) ?? discoveredKind(graph, before)
    if (kind && !isOnDemand(graph, kind)) {
      return {
        affected: true,
        reason: `${path} changes ${kindLabel(kind)}, which runs without being named.`,
        path,
      }
    }
    if (kind) {
      // A map, validator or entity configuration changes how the types it is for behave.
      const mapped = changedMappedTypes(change.before, change.after)
      const targets = mapped ?? [...(after?.targets ?? []), ...(before?.targets ?? [])]
      if (!mapped && !targets.length) {
        return { affected: true, reason: `${path} changes ${kindLabel(kind)} Tasker cannot follow.`, path }
      }
      for (const name of targets) seed(name, mapped ? MAPS : null)
      // Validators are reused by name (`SetValidator(new ChildValidator())`). Profiles are
      // only named to locate their assembly, which their contents do not change.
      if (!mapped) for (const name of [...(after?.declared ?? []), ...(before?.declared ?? [])]) seed(name)
      continue
    }
    const members =
      typeof change.before === 'string' && typeof change.after === 'string'
        ? changedClassMembers(change.before, change.after, graph.declared)
        : null
    if (members) {
      for (const member of members) seed(member.name, member.requires)
      continue
    }
    const names = [...(after?.declared ?? []), ...(before?.declared ?? [])]
    if (!names.length) return { affected: true, reason: `${path} declares no type Tasker can follow.`, path }
    for (const name of names) seed(name)
  }

  const tokenSets = new Map<string, Set<string>>()
  const usesName = (file: string, index: CsharpFileIndex, name: string) => {
    let tokens = tokenSets.get(file)
    if (!tokens) {
      tokens = new Set(index.tokens)
      tokenSets.set(file, tokens)
    }
    if (name === MAPS) return runsMappings(tokens)
    for (const option of name.split('|')) if (tokens.has(option)) return true
    return false
  }
  const labelOf = (entry: ChangedName) =>
    entry.requires === MAPS ? `${entry.name} mapping` : entry.requires ? `${entry.requires}.${entry.name}` : entry.name
  const seen = new Set(seeds.keys())
  // Each queued name keeps the chain of names that led to it, as evidence.
  const queue = [...seeds.values()].map((entry) => ({ ...entry, chain: [labelOf(entry)] }))
  const visited = new Set<string>()
  while (queue.length) {
    const { name, requires, chain } = queue.shift() as ChangedName & { chain: string[] }
    for (const file of graph.mentions.get(name) ?? []) {
      const scope = scopeOf(scopes, file)
      if (!scope) continue
      const index = graph.files.get(file)
      if (!index) continue
      if (requires && !usesName(file, index, requires)) continue
      const label = labelOf({ name, requires })
      const via = chain.length > 1 ? ` (changed ${chain[0]} -> ${chain.slice(1).join(' -> ')})` : ' (changed)'
      if (scope.root) {
        return { affected: true, reason: `Uses ${label}${via} in ${file}.`, path: file }
      }
      const key = index.members || index.mapSegments ? `${file}#${label}` : file
      if (visited.has(key)) continue
      visited.add(key)
      const kind = discoveredKind(graph, index)
      if (kind && !isOnDemand(graph, kind)) {
        return {
          affected: true,
          reason: `${file} is ${kindLabel(kind)} and uses ${label}${via}.`,
          path: file,
        }
      }
      let forward: ChangedName[] = index.declared.map((next) => ({ name: next, requires: null }))
      if (kind) {
        // A reached map, validator or entity configuration changes how the types it is for behave.
        const statements = index.mapSegments?.filter((segment) => segment[1].includes(name)) ?? []
        const targets = index.mapSegments
          ? (statements.length ? statements : index.mapSegments).flatMap((segment) => segment[0])
          : index.targets
        if (!targets.length) {
          return { affected: true, reason: `${file} is ${kindLabel(kind)} Tasker cannot follow.`, path: file }
        }
        forward = targets.map((next) => ({ name: next, requires: index.mapSegments ? MAPS : null }))
      } else if (index.members) {
        // A hub (static class or DbContext) forwards only the members that use the name.
        const using = index.members
          .filter((member) => member[1].includes(name))
          .flatMap((member) => member[0].map((next) => ({ name: next, requires: member[2] })))
        if (using.length) forward = using
      }
      for (const next of forward) {
        const nextKey = `${next.name}|${next.requires ?? ''}`
        if (!seen.has(nextKey)) {
          seen.add(nextKey)
          queue.push({ ...next, chain: [...chain, labelOf(next)] })
        }
      }
    }
  }
  return {
    affected: false,
    traced: [...seeds.values()].map(labelOf).sort(),
  }
}
