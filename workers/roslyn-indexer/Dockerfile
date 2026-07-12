ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:8.0
ARG DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:8.0

FROM ${DOTNET_SDK_IMAGE} AS build
WORKDIR /src
COPY RoslynIndexer.csproj ./
RUN dotnet restore
# O analisador e os contratos HTTP vivem em arquivos C# separados. Copiar todas
# as fontes evita que o build Docker fique diferente do build local do projeto.
COPY *.cs ./
RUN dotnet publish -c Release -o /app --no-restore

FROM ${DOTNET_ASPNET_IMAGE}
WORKDIR /app
COPY --from=build /app ./
EXPOSE 7201
ENTRYPOINT ["dotnet", "RoslynIndexer.dll"]
