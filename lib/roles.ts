// Role names, safe to import from client components (no database here).

export const ROLES = ["ADMIN", "MANAGER", "CASHIER", "SALESPERSON", "INVENTORY", "ACCOUNTANT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin", MANAGER: "Manager", CASHIER: "Cashier",
  SALESPERSON: "Salesperson", INVENTORY: "Inventory clerk", ACCOUNTANT: "Accountant",
};

