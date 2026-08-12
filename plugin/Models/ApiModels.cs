namespace MairsTrivia.Plugin.Models;

// Boundary timestamps must remain DateTimeOffset and UTC.
public sealed record HealthResponse(string Status, string Service, DateTimeOffset Timestamp);
public sealed record HostProfile(Guid Id, string Username, DateTimeOffset CreatedAt);
