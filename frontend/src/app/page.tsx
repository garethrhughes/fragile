export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">AI Starter</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400">
        Full-stack TypeScript starter — Next.js + NestJS + PostgreSQL
      </p>
      <div className="mt-8 flex gap-4">
        <a
          href="http://localhost:3001/health"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Backend Health
        </a>
        <a
          href="http://localhost:3001/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          API Docs
        </a>
      </div>
    </main>
  );
}
