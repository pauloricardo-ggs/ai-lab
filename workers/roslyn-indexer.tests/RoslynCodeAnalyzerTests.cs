using Xunit;

public sealed class RoslynCodeAnalyzerTests
{
    [Fact]
    public void Extracts_symbols_hierarchy_lines_and_semantic_relationships()
    {
        const string source = """
            using System;
            namespace Billing;
            public interface IClock { }
            public class Service : IClock
            {
                public string Name { get; } = "test";
                public Service() { }
                public void Run() { Console.WriteLine(new Service().Name); }
            }
            """;

        var result = RoslynCodeAnalyzer.Analyze(new("Service.cs", "csharp", source));

        Assert.Contains(result.Symbols, s => s.Type == "namespace" && s.FullName == "Billing");
        var service = Assert.Single(result.Symbols, s => s.Type == "class" && s.Name == "Service");
        Assert.Equal("Billing.Service", service.FullName);
        Assert.Equal(4, service.Line);
        Assert.Equal(9, service.EndLine);
        Assert.Contains(result.Symbols, s => s.Type == "method" && s.Name == "Run" && s.ParentFullName == "Billing.Service");
        Assert.Contains(result.Symbols, s => s.Type == "property" && s.Name == "Name" && s.ParentName == "Service");
        Assert.Contains(result.Relationships, r => r.Type == "IMPORTS" && r.TargetName == "System");
        Assert.Contains(result.Relationships, r => r.Kind == "base_type" && r.TargetName == "Billing.IClock");
        Assert.Contains(result.Relationships, r => r.Type == "CALLS" && r.TargetName.EndsWith("WriteLine"));
        Assert.Contains(result.Relationships, r => r.Kind == "object_creation" && r.TargetName == "Billing.Service");
    }

    [Fact]
    public void Covers_record_struct_enum_nested_type_and_overloads()
    {
        const string source = "namespace N { record R(int Id); struct S { enum E { A } class Nested { void M(){} void M(int x){} } } }";
        var result = RoslynCodeAnalyzer.Analyze(new("Types.cs", "csharp", source));
        Assert.Contains(result.Symbols, s => s.Type == "record" && s.Name == "R");
        Assert.Contains(result.Symbols, s => s.Type == "struct" && s.Name == "S");
        Assert.Contains(result.Symbols, s => s.Type == "enum" && s.Name == "E");
        Assert.Equal(2, result.Symbols.Count(s => s.Type == "method" && s.Name == "M"));
        Assert.Contains(result.Symbols, s => s.Name == "Nested" && s.ParentFullName == "N.S");
    }

    [Fact]
    public void Keeps_syntax_fallbacks_for_unresolved_code()
    {
        var result = RoslynCodeAnalyzer.Analyze(new("Broken.cs", "csharp", "class C { void M() { Missing.Call(); var x = new Unknown(); } }"));
        Assert.Contains(result.Relationships, r => r.Type == "CALLS" && r.TargetName == "Call");
        Assert.Contains(result.Relationships, r => r.Kind == "object_creation" && r.TargetName == "Unknown");
    }

    [Fact]
    public void Empty_input_returns_empty_collections()
    {
        var result = RoslynCodeAnalyzer.Analyze(new("Empty.cs", "csharp", ""));
        Assert.Empty(result.Symbols);
        Assert.Empty(result.Relationships);
    }
}
