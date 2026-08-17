import Link from "next/link";
import { signOut } from "@/app/actions";

export function HeaderNav({ currentLevel }: { currentLevel: number }) {
  return (
    <header className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold text-slate-900">
          Translation Summaries
        </Link>
        <nav className="flex items-center gap-3 text-sm text-slate-600">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            Level {currentLevel}
          </span>
          <Link href="/history" className="hover:text-slate-900">
            History
          </Link>
          <Link href="/settings" className="hover:text-slate-900">
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="text-slate-500 hover:text-slate-900"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
