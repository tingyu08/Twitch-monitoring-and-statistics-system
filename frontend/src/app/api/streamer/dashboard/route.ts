import { NextResponse } from "next/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000");

const DASHBOARD_REVALIDATE_SECONDS = 30;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "30d";
    const granularity = searchParams.get("granularity") || "day";
    const subsRange = searchParams.get("subsRange") || range;

    const cookie = request.headers.get("cookie") || "";
    const headers = { cookie };

    const fetchJson = async (path: string) => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers,
        next: { revalidate: DASHBOARD_REVALIDATE_SECONDS },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
      }

      return response.json();
    };

    const [summary, timeSeries, heatmap, subscriptionTrend] = await Promise.all([
      fetchJson(`/api/streamer/me/summary?range=${range}`),
      fetchJson(`/api/streamer/me/time-series?range=${range}&granularity=${granularity}`),
      fetchJson(`/api/streamer/me/heatmap?range=${range}`),
      fetchJson(`/api/streamer/me/subscription-trend?range=${subsRange}`),
    ]);

    return NextResponse.json({
      summary,
      timeSeries,
      heatmap,
      subscriptionTrend,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard bootstrap failed" },
      { status: 500 }
    );
  }
}
