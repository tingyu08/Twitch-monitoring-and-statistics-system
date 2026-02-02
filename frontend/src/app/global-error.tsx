"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white mb-4">500</h1>
          <p className="text-xl text-gray-400 mb-8">Something went wrong</p>
          <button
            onClick={() => reset()}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
