var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:7201");
var app = builder.Build();

app.MapGet("/health", () => Results.Json(new { status = "ok", service = "roslyn-indexer" }));

app.MapPost("/analyze", (AnalyzeRequest request) =>
{
    return Results.Json(RoslynCodeAnalyzer.Analyze(request));
});

app.Run();
