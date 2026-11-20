import { describe, expect, it } from 'vitest'
import {
  buildSymbolGraph,
  type ChangedSource,
  changedClassMembers,
  changedMappedTypes,
  type CsharpFileIndex,
  indexCsharpFile,
  isTracedSource,
  lexCsharp,
  type SourceScope,
  traceImpact,
} from '../convex/lib/csharpImpact'

describe('lexCsharp', () => {
  it('blanks comments in code and literals in structure, keeping offsets', () => {
    const text = 'var a = "/* not a comment */"; // note\nvar b = $"{x}";'
    const { code, structure } = lexCsharp(text)
    expect(code.length).toBe(text.length)
    expect(code).toContain('"/* not a comment */"')
    expect(code).not.toContain('note')
    expect(structure).not.toContain('not a comment')
    expect(structure).toContain('var b')
  })

  it('handles verbatim, raw and nested interpolated strings', () => {
    const text = [
      'var a = @"C:\\path ""quoted"" {";',
      'var b = """',
      '  raw { "quotes" }',
      '  """;',
      'var c = $"{(flag ? "x" : "y")} }}";',
      'class After {}',
    ].join('\n')
    const { structure } = lexCsharp(text)
    expect(structure).toContain('class After {}')
    expect(structure).not.toContain('raw')
    expect(structure.split('{').length - 1).toBe(1)
  })
})

describe('indexCsharpFile', () => {
  it('records declared types, bases, attributes and extension methods', () => {
    const index = indexCsharpFile(`
      namespace App;
      [Serializable, Custom("x")]
      public sealed class OrderDto : BaseDto<int>, IOrder { public int Id { get; set; } }
      public class CustomAttribute : Attribute {}
      public static class OrderExtensions {
        public static (int A, bool B) Pair(this OrderDto order) => (1, true);
        public static bool IsBig(this OrderDto order) => true;
      }
      public delegate void OrderHandler(OrderDto order);
    `)
    expect(index.declared).toEqual(
      expect.arrayContaining(['OrderDto', 'CustomAttribute', 'Custom', 'OrderExtensions', 'Pair', 'IsBig', 'OrderHandler']),
    )
    expect(index.bases).toEqual(expect.arrayContaining(['BaseDto', 'IOrder', 'Attribute']))
    expect(index.attributes).toEqual(expect.arrayContaining(['Serializable', 'Custom']))
    expect(index.tokens).not.toContain('public')
  })

  it('ignores constraints that look like declarations', () => {
    const index = indexCsharpFile('public class Repo<T> where T : class, new() { }')
    expect(index.declared).toEqual(['Repo'])
  })

  it('detects assembly scanning conventions only next to a type listing', () => {
    const scanning = indexCsharpFile(`
      var types = assembly.ExportedTypes.Where(t => typeof(IInstaller).IsAssignableFrom(t) && !t.IsAbstract);
      var marked = assembly.GetTypes().Where(t => t.GetCustomAttribute<JobAttribute>() != null);
    `)
    expect(scanning.scanBases).toEqual(['IInstaller'])
    expect(scanning.scanAttributes).toEqual(['Job'])
    const typeTest = indexCsharpFile(`
      if (typeof(AuditableEntity).IsAssignableFrom(entry.Entity.GetType())) { }
      var ok = Enum.IsDefined(typeof(Status), value);
    `)
    expect(typeTest.scanBases).toEqual([])
    expect(typeTest.scanAttributes).toEqual([])
  })

  it('splits a DbContext into members and records map and validator targets', () => {
    const context = indexCsharpFile(`
      public class AppDbContext : DbContext {
        public DbSet<Order> Orders { get; set; }
        public DbSet<Customer> Customers { get; set; }
      }
    `)
    expect(context.dbContext).toBe(true)
    expect(context.members?.map((member) => member[0])).toEqual([['Orders'], ['Customers']])

    const profile = indexCsharpFile(`
      public class OrderProfile : Profile {
        public OrderProfile() {
          CreateMap<Order, OrderDto>().ForMember(d => d.Total, o => o.MapFrom(s => s.Lines.Sum(l => l.Price)));
          CreateProjection<Customer, CustomerDto>();
        }
      }
    `)
    expect(profile.mapSegments?.map((segment) => segment[0])).toEqual([
      ['Order', 'OrderDto'],
      ['Customer', 'CustomerDto'],
    ])
    expect(indexCsharpFile('public class V : AbstractValidator<OrderDto> {}').targets).toEqual(['OrderDto'])
    expect(indexCsharpFile('class C : IEntityTypeConfiguration<Order> {}').targets).toEqual(['Order'])
  })
})

describe('member and map diffs', () => {
  it('reports changed static members, qualified by class unless they are extensions', () => {
    const before = `public static class Policies {
      public const string Read = "read";
      public static bool Has(this User user) => true;
    }`
    const after = `public static class Policies {
      public const string Read = "read";
      public const string Write = "write";
      public static bool Has(this User user) => false;
    }`
    expect(changedClassMembers(before, after, new Set())).toEqual([
      { name: 'Has', requires: null },
      { name: 'Write', requires: 'Policies' },
    ])
  })

  it('counts a changed constant value', () => {
    const changed = changedClassMembers(
      'public static class Keys { public const string A = "a"; }',
      'public static class Keys { public const string A = "b"; }',
      new Set(),
    )
    expect(changed).toEqual([{ name: 'A', requires: 'Keys' }])
  })

  it('ties DbContext model changes to queries through the context', () => {
    const before = 'public class AppDb : DbContext, IAppDb { public DbSet<Order> Orders { get; set; } }'
    const after =
      'public class AppDb : DbContext, IAppDb { public DbSet<Order> Orders { get; set; } public DbSet<Tag> Tags { get; set; } }'
    expect(changedClassMembers(before, after, new Set(['Tag', 'Order']))).toEqual([
      { name: 'Tags', requires: null },
      { name: 'Tag', requires: 'AppDb|IAppDb' },
    ])
  })

  it('returns the mapped types of changed maps, ignoring usings', () => {
    const before = `using A;
      class P : Profile { public P() { CreateMap<Order, OrderDto>(); CreateMap<Line, LineDto>(); } }`
    const after = `using A; using B;
      class P : Profile { public P() { CreateMap<Order, OrderDto>(); CreateMap<Line, LineDto>().ForMember(d => d.X, o => o.Ignore()); } }`
    expect(changedMappedTypes(before, after)).toEqual(['Line', 'LineDto'])
  })
})

// A small solution: Api (root) -> Common (referenced). Common holds DTOs, a
// static helper, a profile and a consumer.
const FILES: Record<string, string> = {
  'src/Common/OrderDto.cs': 'public class OrderDto { public int Id { get; set; } }',
  'src/Common/InvoiceDto.cs': 'public class InvoiceDto { public int Id { get; set; } }',
  'src/Common/InvoiceService.cs': 'public class InvoiceService { public InvoiceDto Get() => new(); }',
  'src/Common/Keys.cs': 'public static class Keys { public const string Orders = "orders"; public const string Invoices = "inv"; }',
  'src/Common/OrderProfile.cs':
    'using AutoMapper; public class OrderProfile : Profile { public OrderProfile() { CreateMap<Order, OrderDto>(); CreateMap<Invoice, InvoiceDto>(); } }',
  'src/Common/InvoiceConsumer.cs': 'public class InvoiceConsumer : IConsumer<InvoiceDto> { }',
  'src/Common/Order.cs': 'public class Order { }',
  'src/Common/Invoice.cs': 'public class Invoice { }',
  'src/Api/OrdersController.cs':
    'public class OrdersController { private readonly IMapper _mapper; public OrderDto Get() => _mapper.Map<OrderDto>(new Order()); string K => Keys.Orders; }',
}

const SCOPES: SourceScope[] = [
  { kind: 'directory', path: 'src/Api', root: true },
  { kind: 'directory', path: 'src/Common', root: false },
]

function graphFor(overrides: Record<string, string> = {}) {
  const files = new Map<string, CsharpFileIndex>()
  for (const [path, text] of Object.entries({ ...FILES, ...overrides })) files.set(path, indexCsharpFile(text))
  return buildSymbolGraph(files)
}

function change(path: string, after: string, before: string | null = FILES[path] ?? null): ChangedSource {
  return { path, previousPath: null, before, after }
}

describe('traceImpact', () => {
  it('skips a workflow when changed types never reach its own code', () => {
    const after = 'public class InvoiceDto { public int Id { get; set; } public string Note { get; set; } }'
    const graph = graphFor({ 'src/Common/InvoiceDto.cs': after })
    const result = traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/InvoiceDto.cs', after)] })
    // InvoiceDto reaches InvoiceConsumer, a message consumer, which runs without being named.
    expect(result.affected).toBe(true)
    if (result.affected) expect(result.reason).toContain('InvoiceConsumer.cs is a IConsumer type')

    const quiet = traceImpact({
      graph: graphFor({ 'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }' }),
      scopes: SCOPES,
      changes: [change('src/Common/InvoiceDto.cs', after)],
    })
    expect(quiet).toEqual({ affected: false, traced: ['InvoiceDto'] })
  })

  it('marks a workflow affected through a chain of library types', () => {
    const graph = graphFor({
      'src/Api/InvoicesController.cs': 'public class InvoicesController { InvoiceService _s; }',
      'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }',
    })
    const after = 'public class InvoiceDto { public long Id { get; set; } }'
    const result = traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/InvoiceDto.cs', after)] })
    expect(result).toEqual({
      affected: true,
      reason: 'Uses InvoiceService (changed InvoiceDto -> InvoiceService) in src/Api/InvoicesController.cs.',
      path: 'src/Api/InvoicesController.cs',
    })
  })

  it('follows a changed static member only to code that uses that member', () => {
    const graph = graphFor({ 'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }' })
    const used = 'public static class Keys { public const string Orders = "o2"; public const string Invoices = "inv"; }'
    const unused = 'public static class Keys { public const string Orders = "orders"; public const string Invoices = "i2"; }'
    expect(traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/Keys.cs', used)] }).affected).toBe(true)
    expect(traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/Keys.cs', unused)] })).toEqual({
      affected: false,
      traced: ['Keys.Invoices'],
    })
  })

  it('follows a changed map to code that runs mappings of its types', () => {
    const graph = graphFor({ 'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }' })
    const orderMap = FILES['src/Common/OrderProfile.cs'].replace(
      'CreateMap<Order, OrderDto>()',
      'CreateMap<Order, OrderDto>().ForMember(d => d.Id, o => o.Ignore())',
    )
    const result = traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/OrderProfile.cs', orderMap)] })
    expect(result.affected).toBe(true)
    if (result.affected) expect(result.reason).toContain('OrdersController.cs')

    const invoiceMap = FILES['src/Common/OrderProfile.cs'].replace(
      'CreateMap<Invoice, InvoiceDto>()',
      'CreateMap<Invoice, InvoiceDto>().ForMember(d => d.Id, o => o.Ignore())',
    )
    expect(traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/OrderProfile.cs', invoiceMap)] })).toEqual({
      affected: false,
      traced: ['Invoice mapping', 'InvoiceDto mapping'],
    })
  })

  it('treats a profile as always affecting when the repository validates AutoMapper at startup', () => {
    const graph = graphFor({
      'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }',
      'src/Common/Startup.cs': 'public class Startup { void Check(IMapper m) => m.ConfigurationProvider.AssertConfigurationIsValid(); }',
    })
    const invoiceMap = FILES['src/Common/OrderProfile.cs'].replace('CreateMap<Invoice, InvoiceDto>();', '')
    const result = traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/OrderProfile.cs', invoiceMap)] })
    expect(result.affected).toBe(true)
  })

  it('always counts own code, migrations, non-C# files and unreadable files', () => {
    const graph = graphFor()
    const scopes = SCOPES
    expect(traceImpact({ graph, scopes, changes: [change('src/Api/OrdersController.cs', 'class X {}')] })).toMatchObject({
      affected: true,
      reason: 'src/Api/OrdersController.cs is part of its own project.',
    })
    expect(
      traceImpact({ graph, scopes, changes: [change('src/Common/Migrations/0001_Init.cs', 'class M {}')] }),
    ).toMatchObject({ affected: true })
    expect(traceImpact({ graph, scopes, changes: [change('src/Common/settings.json', '{}')] })).toMatchObject({
      affected: true,
      reason: 'src/Common/settings.json is not C# code.',
    })
    expect(
      traceImpact({
        graph,
        scopes,
        changes: [{ path: 'src/Common/OrderDto.cs', previousPath: null, before: null, after: 'unreadable' }],
      }),
    ).toMatchObject({ affected: true })
    const missing = buildSymbolGraph(new Map(), ['src/Common/Huge.cs'])
    expect(traceImpact({ graph: missing, scopes, changes: [] })).toMatchObject({ affected: true })
  })

  it('treats custom conventions found in the repository as discovered', () => {
    const graph = graphFor({
      'src/Common/InvoiceConsumer.cs': 'public class Unrelated { }',
      'src/Common/Installers.cs':
        'public static class Ioc { public static void Run(Assembly a) { foreach (var t in a.ExportedTypes.Where(t => typeof(IModule).IsAssignableFrom(t))) { } } }',
      'src/Common/InvoiceModule.cs': 'public class InvoiceModule : IModule { InvoiceService s; }',
    })
    const after = 'public class InvoiceService { public InvoiceDto Get() => null; }'
    const result = traceImpact({ graph, scopes: SCOPES, changes: [change('src/Common/InvoiceService.cs', after)] })
    expect(result).toMatchObject({ affected: true, path: 'src/Common/InvoiceModule.cs' })
  })

  it('does not index migrations', () => {
    expect(isTracedSource('src/Data/Migrations/0001_Init.cs')).toBe(false)
    expect(isTracedSource('src/Data/Entities/Order.cs')).toBe(true)
  })
})
