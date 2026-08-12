using System.Net.Http.Headers;

namespace MairsTrivia.Plugin.Api;

/// <summary>The only plugin HTTP boundary. Requests are immutable after construction and before SendAsync.</summary>
public sealed class TriviaApiClient(HttpClient httpClient)
{
    public async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, Uri url, string? bearerToken, HttpContent? body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, url) { Content = body };
        if (!string.IsNullOrWhiteSpace(bearerToken))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);

        // No rewriting, interception, or mutation occurs after this point.
        return await httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
    }
}
