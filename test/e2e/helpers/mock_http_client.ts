/**
 * ==============================================================================
 * E2E Test Helper: Native Mock HTTP Client (`mock_http_client.ts`)
 * ==============================================================================
 * Zero-dependency HTTP client using Node.js built-in `node:http` to query
 * local x402 Micropayment server endpoints without external libraries.
 * Supports standard URLs and IPC named pipes / unix domain sockets (`socketPath`).
 */

import http from 'node:http';

export interface HttpResponse<T = any> {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: T;
  rawText: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  socketPath?: string;
}

export class MockHttpClient {
  public static async request<T = any>(
    url: string,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.requestOnce<T>(url, options);
      } catch (err: any) {
        const isTransientPipeError =
          options?.socketPath &&
          (err?.code === 'ENOENT' || err?.code === 'EBUSY' || err?.code === 'ECONNREFUSED');
        if (isTransientPipeError && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 15 * attempt));
          continue;
        }
        throw err;
      }
    }
    return this.requestOnce<T>(url, options);
  }

  private static async requestOnce<T = any>(
    url: string,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      const isSocket = !!options?.socketPath;
      const parsed = isSocket ? null : new URL(url);
      const reqHeaders: Record<string, string> = { ...options?.headers };
      let payload = '';

      if (options?.body !== undefined && options?.body !== null) {
        payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const reqOptions: http.RequestOptions = {
        method: options?.method || 'GET',
        headers: reqHeaders,
      };

      if (isSocket) {
        reqOptions.socketPath = options.socketPath;
        reqOptions.path = url.startsWith('http') ? (new URL(url).pathname + new URL(url).search) : url;
      } else if (parsed) {
        reqOptions.hostname = parsed.hostname;
        reqOptions.port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
        reqOptions.path = parsed.pathname + parsed.search;
      }

      const req = http.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let body: any = data;
          try {
            body = JSON.parse(data);
          } catch {
            // Raw text fallback
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
            rawText: data,
          });
        });
      });

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  public static async get<T = any>(
    url: string,
    headers?: Record<string, string>,
    socketPath?: string
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { method: 'GET', headers, socketPath });
  }

  public static async post<T = any>(
    url: string,
    body?: any,
    headers?: Record<string, string>,
    socketPath?: string
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { method: 'POST', body, headers, socketPath });
  }
}
