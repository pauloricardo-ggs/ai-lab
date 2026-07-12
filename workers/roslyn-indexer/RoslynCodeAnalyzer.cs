using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Text.Json.Serialization;

public static class RoslynCodeAnalyzer
{
    public static AnalyzeResponse Analyze(AnalyzeRequest request)
    {
        var tree = CSharpSyntaxTree.ParseText(request.Content ?? "", path: request.FilePath ?? "");
        var root = tree.GetCompilationUnitRoot();
        var compilation = CSharpCompilation.Create("IndexingAssembly", new[] { tree }, BasicReferences(),
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        var semanticModel = compilation.GetSemanticModel(tree, ignoreAccessibility: true);
        var symbols = new List<SymbolResult>();
        var relationships = new List<RelationshipResult>();

        foreach (var node in root.DescendantNodes())
        {
            switch (node)
            {
                case NamespaceDeclarationSyntax d: symbols.Add(Symbol("namespace", d.Name.ToString(), d, semanticModel)); break;
                case FileScopedNamespaceDeclarationSyntax d: symbols.Add(Symbol("namespace", d.Name.ToString(), d, semanticModel)); break;
                case ClassDeclarationSyntax d: AddType(symbols, relationships, "class", d.Identifier.Text, d, d.BaseList, semanticModel); break;
                case InterfaceDeclarationSyntax d: AddType(symbols, relationships, "interface", d.Identifier.Text, d, d.BaseList, semanticModel); break;
                case RecordDeclarationSyntax d: AddType(symbols, relationships, "record", d.Identifier.Text, d, d.BaseList, semanticModel); break;
                case StructDeclarationSyntax d: AddType(symbols, relationships, "struct", d.Identifier.Text, d, d.BaseList, semanticModel); break;
                case EnumDeclarationSyntax d: symbols.Add(Symbol("enum", d.Identifier.Text, d, semanticModel)); break;
                case MethodDeclarationSyntax d: symbols.Add(Symbol("method", d.Identifier.Text, d, semanticModel)); break;
                case ConstructorDeclarationSyntax d: symbols.Add(Symbol("constructor", d.Identifier.Text, d, semanticModel)); break;
                case PropertyDeclarationSyntax d: symbols.Add(Symbol("property", d.Identifier.Text, d, semanticModel)); break;
                case UsingDirectiveSyntax d: relationships.Add(Relationship("IMPORTS", d.Name?.ToString() ?? "", d, "using", semanticModel)); break;
                case InvocationExpressionSyntax d: relationships.Add(Relationship("CALLS", InvocationName(d, semanticModel), d, "invocation", semanticModel)); break;
                case ObjectCreationExpressionSyntax d: relationships.Add(Relationship("REFERENCES", SemanticTypeName(d.Type, semanticModel) ?? d.Type.ToString(), d, "object_creation", semanticModel)); break;
            }
        }
        return new AnalyzeResponse(symbols, relationships);
    }

    private static IEnumerable<MetadataReference> BasicReferences()
    {
        var trustedPlatformAssemblies = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string)?
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries) ?? [];
        var loadedAssemblies = AppDomain.CurrentDomain.GetAssemblies()
            .Where(a => !a.IsDynamic && !string.IsNullOrWhiteSpace(a.Location)).Select(a => a.Location);
        return trustedPlatformAssemblies.Concat(loadedAssemblies).Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(location => MetadataReference.CreateFromFile(location));
    }

    private static void AddType(List<SymbolResult> symbols, List<RelationshipResult> relationships, string type, string name,
        TypeDeclarationSyntax declaration, BaseListSyntax? baseList, SemanticModel semanticModel)
    {
        symbols.Add(Symbol(type, name, declaration, semanticModel));
        if (baseList is null) return;
        foreach (var baseType in baseList.Types)
            relationships.Add(Relationship("REFERENCES", SemanticTypeName(baseType.Type, semanticModel) ?? baseType.Type.ToString(),
                baseType, "base_type", semanticModel, new Dictionary<string, object?> { ["source"] = name }));
    }

    private static SymbolResult Symbol(string type, string name, SyntaxNode node, SemanticModel semanticModel)
    {
        var declared = DeclaredSymbol(node, semanticModel);
        var parent = declared?.ContainingSymbol;
        return new SymbolResult(type, name, Display(declared) ?? name, Line(node), EndLine(node),
            string.IsNullOrWhiteSpace(parent?.Name) ? null : parent.Name,
            string.IsNullOrWhiteSpace(parent?.Name) ? null : Display(parent),
            new Dictionary<string, object?> { ["roslyn_kind"] = node.Kind().ToString(), ["symbol_kind"] = declared?.Kind.ToString() });
    }

    private static RelationshipResult Relationship(string type, string targetName, SyntaxNode node, string kind,
        SemanticModel semanticModel, Dictionary<string, object?>? metadata = null)
    {
        var resolved = SymbolInfoName(node, semanticModel);
        var payload = metadata is null ? new Dictionary<string, object?>() : new(metadata);
        if (!string.IsNullOrWhiteSpace(resolved)) payload["semantic_target"] = resolved;
        return new RelationshipResult(type, resolved ?? targetName, kind, Line(node), payload);
    }

    private static ISymbol? DeclaredSymbol(SyntaxNode node, SemanticModel model) => node switch
    {
        NamespaceDeclarationSyntax d => model.GetDeclaredSymbol(d), FileScopedNamespaceDeclarationSyntax d => model.GetDeclaredSymbol(d),
        ClassDeclarationSyntax d => model.GetDeclaredSymbol(d), InterfaceDeclarationSyntax d => model.GetDeclaredSymbol(d),
        RecordDeclarationSyntax d => model.GetDeclaredSymbol(d), StructDeclarationSyntax d => model.GetDeclaredSymbol(d),
        EnumDeclarationSyntax d => model.GetDeclaredSymbol(d), MethodDeclarationSyntax d => model.GetDeclaredSymbol(d),
        ConstructorDeclarationSyntax d => model.GetDeclaredSymbol(d), PropertyDeclarationSyntax d => model.GetDeclaredSymbol(d), _ => null
    };

    private static string? SymbolInfoName(SyntaxNode node, SemanticModel model) => Display(node switch
    {
        InvocationExpressionSyntax d => BestSymbol(model.GetSymbolInfo(d.Expression)),
        ObjectCreationExpressionSyntax d => model.GetSymbolInfo(d.Type).Symbol,
        BaseTypeSyntax d => model.GetSymbolInfo(d.Type).Symbol,
        UsingDirectiveSyntax d when d.Name is not null => model.GetSymbolInfo(d.Name).Symbol,
        _ => null
    });

    private static string InvocationName(InvocationExpressionSyntax invocation, SemanticModel model)
    {
        var resolved = Display(BestSymbol(model.GetSymbolInfo(invocation.Expression)));
        if (resolved is not null) return resolved;
        return invocation.Expression switch
        {
            IdentifierNameSyntax i => i.Identifier.Text, MemberAccessExpressionSyntax m => m.Name.Identifier.Text,
            GenericNameSyntax g => g.Identifier.Text, _ => invocation.Expression.ToString()
        };
    }

    private static string? SemanticTypeName(TypeSyntax type, SemanticModel model) => Display(model.GetTypeInfo(type).Type);
    private static ISymbol? BestSymbol(SymbolInfo info) => info.Symbol ?? info.CandidateSymbols.FirstOrDefault();
    private static string? Display(ISymbol? symbol) => symbol?.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
    private static int Line(SyntaxNode node) => node.SyntaxTree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
    private static int EndLine(SyntaxNode node) => node.SyntaxTree.GetLineSpan(node.Span).EndLinePosition.Line + 1;
}

public record AnalyzeRequest([property: JsonPropertyName("file_path")] string FilePath,
    [property: JsonPropertyName("language")] string Language, [property: JsonPropertyName("content")] string Content);
public record AnalyzeResponse([property: JsonPropertyName("symbols")] IReadOnlyList<SymbolResult> Symbols,
    [property: JsonPropertyName("relationships")] IReadOnlyList<RelationshipResult> Relationships);
public record SymbolResult([property: JsonPropertyName("type")] string Type, [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("full_name")] string FullName, [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("end_line")] int EndLine, [property: JsonPropertyName("parent_name")] string? ParentName,
    [property: JsonPropertyName("parent_full_name")] string? ParentFullName,
    [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);
public record RelationshipResult([property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("target_name")] string TargetName, [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("line")] int Line, [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);
