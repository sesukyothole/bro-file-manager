import { Github } from "lucide-react";
import { BRAND_TITLE } from "../constants";

export function Footer() {
    const year = new Date().getFullYear();

    return (
        <footer className="w-full py-6 mt-auto border-t border-[rgba(28,37,43,0.05)]">
            <div className="flex flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]">
                <p className="font-light">
                    &copy; {year} {BRAND_TITLE}. Free and open-source file manager.
                </p>
                <div className="flex items-center gap-4">
                    <a
                        href="https://github.com/mgilank/bro-file-manager"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 hover:text-[var(--ink)] transition-colors text-neutral-600"
                        aria-label="GitHub Repository"
                    >
                        <Github size={16} />
                        <span>Source</span>
                    </a>
                    <span className="opacity-30">•</span>
                    <span className="flex items-center gap-1">
                        Sponsored by{" "}
                        <a
                            href="https://www.jetorbit.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold hover:text-[var(--ink)] transition-colors text-neutral-600"
                        >
                            jetorbit.com
                        </a>
                    </span>
                </div>
            </div>
        </footer>
    );
}
