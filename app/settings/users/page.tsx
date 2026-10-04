import { sql } from "@/lib/db";
import { requirePermission, ROLE_LABEL, ROLE_PERMISSIONS, ROLES } from "@/lib/auth";
import { UserForm } from "@/components/user-form";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Users" };

export default async function Users() {
  const admin = await requirePermission("users.manage");
  const users = await sql`
    select id, name, email, role, is_active, last_login_at
      from app_user where company_id = ${admin.companyId} order by is_active desc, name`;

  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
        <p className="page-sub">Who can sign in, and what their role lets them do. Checked on the server for every page and action.</p>
      </div>

      <div className="section-grid">
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.name}{!u.is_active && <span className="pill reversed">inactive</span>}</td>
                  <td>{u.email ?? "—"}</td>
                  <td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</td>
                  <td>{u.last_login_at ? dateTime(u.last_login_at) : "never"}</td>
                  <td>
                    <details>
                      <summary className="linkish">Edit</summary>
                      <UserForm user={{ id: u.id, name: u.name, email: u.email ?? "", role: u.role, is_active: u.is_active }} />
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h2>Add a person</h2></div>
          <div className="card-body"><UserForm /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>What each role can do</h2></div>
        <table>
          <tbody>
            {ROLES.map((r) => (
              <tr key={r}>
                <td><strong>{ROLE_LABEL[r]}</strong></td>
                <td className="prod-sub">{ROLE_PERMISSIONS[r].join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
