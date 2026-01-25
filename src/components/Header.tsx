import { FilterX, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { BRAND_EYEBROW, BRAND_SUBTITLE, BRAND_TITLE, THEMES } from "../constants";
import type { AuthState, DateFilter, Theme, TypeFilter, UserRole } from "../types";
import { CollapseIcon, ExpandIcon } from "./icons";

type HeaderProps = {
  auth: AuthState;
  username: string;
  userRole: UserRole;
  theme: Theme;
  showTrash: boolean;
  filtersOpen: boolean;
  filtersActive: boolean;
  typeFilter: TypeFilter;
  sizeMinMb: string;
  sizeMaxMb: string;
  dateFilter: DateFilter;
  onThemeChange: (theme: Theme) => void;
  onLogout: () => void;
  onToggleFilters: () => void;
  onTypeFilterChange: (value: TypeFilter) => void;
  onSizeMinChange: (value: string) => void;
  onSizeMaxChange: (value: string) => void;
  onDateFilterChange: (value: DateFilter) => void;
  onClearFilters: () => void;
  onOpenS3Settings?: () => void;
  onNavigateHome?: () => void;
};

export function Header({
  auth,
  username,
  userRole,
  theme,
  showTrash,
  filtersOpen,
  filtersActive,
  typeFilter,
  sizeMinMb,
  sizeMaxMb,
  dateFilter,
  onThemeChange,
  onLogout,
  onToggleFilters,
  onTypeFilterChange,
  onSizeMinChange,
  onSizeMaxChange,
  onDateFilterChange,
  onClearFilters,
  onOpenS3Settings,
  onNavigateHome,
}: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  return (
    <header className="header">
      <div className="header-brand-container">
        <div>
          <p className="eyebrow">{BRAND_EYEBROW}</p>
          <div className="brand-title">
            <button
              onClick={onNavigateHome}
              className="flex items-center gap-3 bg-transparent border-none p-0 cursor-pointer hover:opacity-80 transition-opacity text-left"
              style={{ fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit' }}
              aria-label="Go to home"
            >
              <img className="brand-logo" src="/logo.png" alt={`${BRAND_TITLE} logo`} />
              <h1>{BRAND_TITLE}</h1>
            </button>
          </div>
          <p className="subtitle">{BRAND_SUBTITLE}</p>
          {auth === "authed" ? (
            <p className="meta">
              Signed in as {username || "unknown"} ({userRole})
            </p>
          ) : null}
        </div>
        <button
          className="burger-menu-btn w-12 h-12"
          onClick={toggleMobileMenu}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          style={{ zIndex: 50 }}
        >
          {isMobileMenuOpen ? <X key="close" className="w-6 h-6" /> : <Menu key="menu" className="w-6 h-6" />}
        </button>
      </div>

      <div className={`header-actions ${isMobileMenuOpen ? "is-open" : ""}`}>
        <div className="header-controls">
          <label className="theme-switcher">
            <span>Theme</span>
            <select value={theme} onChange={(event) => onThemeChange(event.target.value as Theme)}>
              {THEMES.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0).toUpperCase()}
                  {option.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {auth === "authed" ? (
            <>
              {userRole === "admin" && onOpenS3Settings && (
                <button
                  className="ghost"
                  onClick={onOpenS3Settings}
                  aria-label="S3 Settings"
                  title="S3 Settings"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    <path d="M12 12v6m-3-3h6" />
                  </svg>
                </button>
              )}
              <button className="ghost" onClick={onLogout} aria-label="Logout" title="Logout">
                <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {auth === "authed" && !showTrash ? (
            <button
              className={`ghost filters-trigger${filtersOpen ? " is-active" : ""}`}
              type="button"
              onClick={onToggleFilters}
              aria-expanded={filtersOpen}
              aria-controls="filters-panel"
              aria-label={filtersOpen ? "Collapse filters" : "Expand filters"}
              title={filtersOpen ? "Collapse filters" : "Expand filters"}
            >
              Filters
              {filtersOpen ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          ) : null}
        </div>
        {auth === "authed" && !showTrash ? (
          <div className={`header-filters${filtersOpen ? " is-open" : ""}`}>
            <div
              id="filters-panel"
              className={`filters-panel ${filtersOpen ? "open" : "collapsed"}`}
              aria-hidden={!filtersOpen}
            >
              <div className="filter-controls">
                <div className="filter-group">
                  <label className="filter-label" htmlFor="type-filter">
                    Type
                  </label>
                  <select
                    id="type-filter"
                    value={typeFilter}
                    onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}
                  >
                    <option value="all">All entries</option>
                    <option value="dir">Folders</option>
                    <option value="file">Files</option>
                    <option value="image">Images</option>
                    <option value="audio">Audio</option>
                    <option value="video">Video</option>
                    <option value="document">Documents</option>
                    <option value="archive">Archives</option>
                    <option value="other">Other files</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="size-min">
                    Size (MB)
                  </label>
                  <div className="filter-range">
                    <input
                      id="size-min"
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Min"
                      value={sizeMinMb}
                      onChange={(event) => onSizeMinChange(event.target.value)}
                    />
                    <input
                      id="size-max"
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Max"
                      value={sizeMaxMb}
                      onChange={(event) => onSizeMaxChange(event.target.value)}
                    />
                  </div>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="date-filter">
                    Modified
                  </label>
                  <select
                    id="date-filter"
                    value={dateFilter}
                    onChange={(event) => onDateFilterChange(event.target.value as DateFilter)}
                  >
                    <option value="any">Any time</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                  </select>
                </div>
                <div className="filter-group filter-actions">
                  <button
                    className="ghost"
                    onClick={onClearFilters}
                    disabled={!filtersActive}
                    aria-label="Reset filters"
                    title="Reset filters"
                  >
                    <FilterX size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
