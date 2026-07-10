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
    var symbols = new List<SymbolResult>();
    var relationships = new List<RelationshipResult>();

    foreach (var node in root.DescendantNodes())
    {
        switch (node)
        {
            case NamespaceDeclarationSyntax namespaceDeclaration:
                symbols.Add(Symbol("namespace", namespaceDeclaration.Name.ToString(), namespaceDeclaration));
                break;
            case FileScopedNamespaceDeclarationSyntax namespaceDeclaration:
                symbols.Add(Symbol("namespace", namespaceDeclaration.Name.ToString(), namespaceDeclaration));
                break;
            case ClassDeclarationSyntax declaration:
                AddType(symbols, relationships, "class", declaration.Identifier.Text, declaration, declaration.BaseList);
                break;
            case InterfaceDeclarationSyntax declaration:
                AddType(symbols, relationships, "interface", declaration.Identifier.Text, declaration, declaration.BaseList);
                break;
            case RecordDeclarationSyntax declaration:
                AddType(symbols, relationships, "record", declaration.Identifier.Text, declaration, declaration.BaseList);
                break;
            case StructDeclarationSyntax declaration:
                AddType(symbols, relationships, "struct", declaration.Identifier.Text, declaration, declaration.BaseList);
                break;
            case EnumDeclarationSyntax declaration:
                symbols.Add(Symbol("enum", declaration.Identifier.Text, declaration));
                break;
            case MethodDeclarationSyntax declaration:
                symbols.Add(Symbol("method", declaration.Identifier.Text, declaration));
                break;
            case ConstructorDeclarationSyntax declaration:
                symbols.Add(Symbol("constructor", declaration.Identifier.Text, declaration));
                break;
            case PropertyDeclarationSyntax declaration:
                symbols.Add(Symbol("property", declaration.Identifier.Text, declaration));
                break;
            case UsingDirectiveSyntax declaration:
                relationships.Add(Relationship("IMPORTS", declaration.Name?.ToString() ?? "", declaration, "using"));
                break;
            case InvocationExpressionSyntax invocation:
                relationships.Add(Relationship("CALLS", InvocationName(invocation), invocation, "invocation"));
                break;
            case ObjectCreationExpressionSyntax creation:
                relationships.Add(Relationship("REFERENCES", creation.Type.ToString(), creation, "object_creation"));
                break;
        }
    }

    return Results.Json(new AnalyzeResponse(symbols, relationships));
});

app.Run();

static void AddType(List<SymbolResult> symbols, List<RelationshipResult> relationships, string type, string name, TypeDeclarationSyntax declaration, BaseListSyntax? baseList)
{
    symbols.Add(Symbol(type, name, declaration));
    if (baseList is null)
    {
        return;
    }

    foreach (var baseType in baseList.Types)
    {
        relationships.Add(Relationship("REFERENCES", baseType.Type.ToString(), baseType, "base_type", new Dictionary<string, object?>
        {
            ["source"] = name
        }));
    }
}

static SymbolResult Symbol(string type, string name, SyntaxNode node)
{
    return new SymbolResult(
        type,
        name,
        name,
        Line(node),
        new Dictionary<string, object?>
        {
            ["roslyn_kind"] = node.Kind().ToString()
        });
}

static RelationshipResult Relationship(string type, string targetName, SyntaxNode node, string kind, Dictionary<string, object?>? metadata = null)
{
    return new RelationshipResult(
        type,
        targetName,
        kind,
        Line(node),
        metadata ?? new Dictionary<string, object?>());
}

static string InvocationName(InvocationExpressionSyntax invocation)
{
    return invocation.Expression switch
    {
        IdentifierNameSyntax identifier => identifier.Identifier.Text,
        MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.Text,
        GenericNameSyntax generic => generic.Identifier.Text,
        _ => invocation.Expression.ToString()
    };
}

static int Line(SyntaxNode node)
{
    return node.SyntaxTree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
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
    [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);

record RelationshipResult(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("target_name")] string TargetName,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("metadata")] IReadOnlyDictionary<string, object?> Metadata);
