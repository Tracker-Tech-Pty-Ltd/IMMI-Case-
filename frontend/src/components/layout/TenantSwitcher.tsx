import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function TenantSwitcher() {
  const { tenant, tenants, switchTenant, isAuthenticated } = useAuth();
  const [switching, setSwitching] = useState(false);

  if (!isAuthenticated || tenants.length <= 1) return null;

  const handleSwitch = async (tenantId: string) => {
    if (tenantId === tenant?.id) return;
    setSwitching(true);
    try {
      await switchTenant(tenantId);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative">
      <select
        value={tenant?.id || ""}
        onChange={(e) => handleSwitch(e.target.value)}
        disabled={switching}
        className="text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] cursor-pointer"
        aria-label="Switch workspace"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.kind === "individual" ? "👤" : "🏢"} {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
