FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["MockContractWebService.csproj", "./"]
RUN dotnet restore "MockContractWebService.csproj"
COPY . .
WORKDIR "/src"
RUN dotnet build "MockContractWebService.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "MockContractWebService.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Set the port for Azure Container Apps
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "MockContractWebService.dll"]
