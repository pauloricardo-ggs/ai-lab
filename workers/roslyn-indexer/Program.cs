using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:7201");
var app = builder.Build();

app.MapGet("/health", () => Results.Json(new { status = "ok", service = "roslyn-indexer" }));

app.MapPost("/analyze", (AnalyzeRequest request) =>
{
    var tree = CSharpSyntaxTree.ParseText(request.Content ?? "");
    var root = tree.GetCompilationUnitRoot();
    var compilation = CSharpCompilation.Create(
        "IndexingAssembly",
        new[] { tree },
        BasicReferences(),
        new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
    var semanticModel = compilation.GetSemanticModel(tree, ignoreAccessibility: true);
    var symbols = new List<SymbolResult>();
    var relationships = new List<RelationshipResult>();

    foreach (var node in root.DescendantNodes())
    {
        switch (node)
        {
            case NamespaceDeclarationSyntax namespaceDeclaration:
                symbols.Add(Symbol("namespace", namespaceDeclaration.Name.ToString(), namespaceDeclaration, semanticModel));
                break;
            case FileScopedNamespaceDeclarationSyntax namespaceDeclaration:
                symbols.Add(Symbol("namespace", namespaceDeclaration.Name.ToString(), namespaceDeclaration, semanticModel));
                break;
            case ClassDeclarationSyntax declaration:
                AddType(symbols, relationships, "class", declaration.Identifier.Text, declaration, declaration.BaseList, semanticModel);
                break;
            case InterfaceDeclarationSyntax declaration:
                AddType(symbols, relationships, "interface", declaration.Identifier.Text, declaration, declaration.BaseList, semanticModel);
                break;
            case RecordDeclarationSyntax declaration:
                AddType(symbols, relationships, "record", declaration.Identifier.Text, declaration, declaration.BaseList, semanticModel);
                break;
            case StructDeclarationSyntax declaration:
                AddType(symbols, relationships, "struct", declaration.Identifier.Text, declaration, declaration.BaseList, semanticModel);
                break;
            case EnumDeclarationSyntax declaration:
                symbols.Add(Symbol("enum", declaration.Identifier.Text, declaration, semanticModel));
                break;
            case MethodDeclarationSyntax declaration:
                symbols.Add(Symbol("method", declaration.Identifier.Text, declaration, semanticModel));
                break;
            case ConstructorDeclarationSyntax declaration:
                symbols.Add(Symbol("constructor", declaration.Identifier.Text, declaration, semanticModel));
                break;
            case PropertyDeclarationSyntax declaration:
                symbols.Add(Symbol("property", declaration.Identifier.Text, declaration, semanticModel));
                break;
            case UsingDirectiveSyntax declaration:
                relationships.Add(Relationship("IMPORTS", declaration.Name?.ToString() ?? "", declaration, "using", semanticModel));
                break;
            case InvocationExpressionSyntax invocation:
                relationships.Add(Relationship("CALLS", InvocationName(invocation, semanticModel), invocation, "invocation", semanticModel));
                break;
            case ObjectCreationExpressionSyntax creation:
                relationships.Add(Relationship("REFERENCES", SemanticTypeName(creation.Type, semanticModel) ?? creation.Type.ToString(), creation, "object_creation", semanticModel));
                break;
        }
    }

    return Results.Json(new AnalyzeResponse(symbols, relationships));
});

app.Run();

static IEnumerable<MetadataReference> BasicReferences()
{
    var assemblies = AppDomain.CurrentDomain.GetAssemblies()
        .Where(assembly => !assembly.IsDynamic && !string.IsNullOrWhiteSpace(assembly.Location))
        .Select(assembly => assembly.Location)
        .Distinct(StringComparer.OrdinalIgnoreCase);

    foreach (var location in assemblies)
    {
        yield return MetadataReference.CreateFromFile(location);
    }
}

static void AddType(List<SymbolResult> symbols, List<RelationshipResult> relationships, string type, string name, TypeDeclarationSyntax declaration, BaseListSyntax? baseList, SemanticModel semanticModel)
{
    symbols.Add(Symbol(type, name, declaration, semanticModel));
    if (baseList is null)
    {
        return;
    }

    foreach (var baseType in baseList.Types)
    {
        relationships.Add(Relationship("REFERENCES", SemanticTypeName(baseType.Type, semanticModel) ?? baseType.Type.ToString(), baseType, "base_type", semanticModel, new Dictionary<string, object?>
        {
            ["source"] = name
        }));
    }
}

static SymbolResult Symbol(string type, string name, SyntaxNode node, SemanticModel semanticModel)
{
    var declaredSymbol = DeclaredSymbol(node, semanticModel);
    var parent = declaredSymbol?.ContainingSymbol;
    var fullName = declaredSymbol is null ? name : declaredSymbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
    var parentName = string.IsNullOrWhiteSpace(parent?.Name) ? null : parent.Name;
    var parentFullName = parent is null || string.IsNullOrWhiteSpace(parent.Name)
        ? null
        : parent.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
    return new SymbolResult(
        type,
        name,
        fullName,
        Line(node),
        EndLine(node),
        parentName,
        parentFullName,
        new Dictionary<string, object?>
        {
            ["roslyn_kind"] = node.Kind().ToString(),
            ["symbol_kind"] = declaredSymbol?.Kind.ToString()
        });
}

static RelationshipResult Relationship(string type, string targetName, SyntaxNode node, string kind, SemanticModel semanticModel, Dictionary<string, object?>? metadata = null)
{
    var resolvedName = SymbolInfoName(node, semanticModel);
    var payload = metadata is null
        ? new Dictionary<string, object?>()
        : new Dictionary<string, object?>(metadata);
    if (!string.IsNullOrWhiteSpace(resolvedName))
    {
        payload["semantic_target"] = resolvedName;
    }

    return new RelationshipResult(
        type,
        resolvedName ?? targetName,
        kind,
        Line(node),
        payload);
}

static ISymbol? DeclaredSymbol(SyntaxNode node, SemanticModel semanticModel)
{
    return node switch
    {
        NamespaceDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        FileScopedNamespaceDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        ClassDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        InterfaceDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        RecordDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        StructDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        EnumDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        MethodDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        ConstructorDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        PropertyDeclarationSyntax declaration => semanticModel.GetDeclaredSymbol(declaration),
        _ => null
    };
}

static string? SymbolInfoName(SyntaxNode node, SemanticModel semanticModel)
{
    ISymbol? symbol = node switch
    {
        InvocationExpressionSyntax invocation => semanticModel.GetSymbolInfo(invocation).Symbol,
        ObjectCreationExpressionSyntax creation => semanticModel.GetSymbolInfo(creation.Type).Symbol,
        BaseTypeSyntax baseType => semanticModel.GetSymbolInfo(baseType.Type).Symbol,
        UsingDirectiveSyntax directive when directive.Name is not null => semanticModel.GetSymbolInfo(directive.Name).Symbol,
        _ => null
    };

    return symbol?.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
}

static string InvocationName(InvocationExpressionSyntax invocation, SemanticModel semanticModel)
{
    var symbol = semanticModel.GetSymbolInfo(invocation).Symbol;
    if (symbol is not null)
    {
        return symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
    }

    return invocation.Expression switch
    {
        IdentifierNameSyntax identifier => identifier.Identifier.Text,
        MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.Text,
        GenericNameSyntax generic => generic.Identifier.Text,
        _ => invocation.Expression.ToString()
    };
}

static string? SemanticTypeName(TypeSyntax type, SemanticModel semanticModel)
{
    return semanticModel.GetTypeInfo(type).Type?.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "");
}

static int Line(SyntaxNode node)
{
    return node.SyntaxTree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
}

static int EndLine(SyntaxNode node)
{
    return node.SyntaxTree.GetLineSpan(node.Span).EndLinePosition.Line + 1;
}

record AnalyzeRequest(
    [property: JsonPropertyName("file_path")] string FilePath,
    [property: JsonPropertyName("language")] string Language,
    [property: JsonPropertyName("content")] string Content);

record AnalyzeResponse(
    [property: JsonPropertyName("symbols")] IReadOnlyList<SymbolResult> Symbols,
    [property: JsonPropertyName("relationships")] IReadOnlyList<RelationshipResult> Relationships);

record SymbolResult(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("full_name")] string FullName,
    [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("end_line")] int EndLine,
    [property: JsonPropertyName("parent_name")] string? ParentName,
    [property: JsonPropertyName("parent_full_name")] string? ParentFullName,
    [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);

record RelationshipResult(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("target_name")] string TargetName,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);
