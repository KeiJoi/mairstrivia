using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace MairsTrivia.Plugin.Api;
/// <summary>The sole backend transport. Every immutable request is complete before SendAsync; it never interacts with FFXIV traffic.</summary>
public sealed class TriviaApiClient : IDisposable
{
    private readonly HttpClient http; private readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web);
    public TriviaApiClient(Uri baseUri) => http = new HttpClient { BaseAddress = baseUri, Timeout = TimeSpan.FromSeconds(15) };
    public async Task<T> GetAsync<T>(string path, string? accessToken, CancellationToken cancellationToken) => await SendAsync<T>(HttpMethod.Get,path,accessToken,null,null,cancellationToken);
    public async Task<T> PostAsync<T>(string path, object body, string? accessToken, string? serverPassword, CancellationToken cancellationToken) => await SendAsync<T>(HttpMethod.Post,path,accessToken,serverPassword,body,cancellationToken);
    private async Task<T> SendAsync<T>(HttpMethod method,string path,string? accessToken,string? serverPassword,object? payload,CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, new Uri(http.BaseAddress!, path));
        if (!string.IsNullOrEmpty(accessToken)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (!string.IsNullOrEmpty(serverPassword)) request.Headers.Add("X-Server-Access-Password", serverPassword);
        if (payload is not null) request.Content = JsonContent.Create(payload, options: json);
        using var response = await http.SendAsync(request, ct).ConfigureAwait(false);
        var text=await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if(!response.IsSuccessStatusCode) throw new TriviaApiException($"Backend returned {(int)response.StatusCode}: {text}");
        return JsonSerializer.Deserialize<T>(text,json) ?? throw new TriviaApiException("Backend returned an empty response.");
    }
    public void Dispose()=>http.Dispose();
}
public sealed class TriviaApiException(string message) : Exception(message);
