"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { Modal, SearchSelect, Stat, formValues, titleCase } from "./shared";
import type { Data, Row } from "./shared";

export function UserManagementModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"users" | "roles" | "reminders">("users");
  const [selectedRoleId, setSelectedRoleId] = useState<number>(
    Number(data.roles[0]?.id || 0),
  );
  const [editingUser, setEditingUser] = useState<Row | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Row | null>(null);
  const [passwordUser, setPasswordUser] = useState<Row | null>(null);
  const moduleLabels: Record<string, string> = {
    hostels: "Hostel information",
    "hostels-sales": "Hostel sales availability, reservations & pricing",
    "hostels-rates": "Hostel electricity and operating rates",
    "hostels-occupancy": "Occupant & vacancy register",
    "units-general": "Unit general information",
    "units-owner": "Unit & owner agreements",
    students: "Student information",
    parking: "Parking",
    maintenance: "Maintenance & meter readings",
    finance: "Finance",
    announcements: "Announcements",
    reports: "Reports",
    users: "User management",
  };
  const selectedRole =
    data.roles.find((role) => Number(role.id) === selectedRoleId) ||
    data.roles[0];
  const rolePermissions = data.rolePermissions.filter(
    (permission) => Number(permission.roleId) === Number(selectedRole?.id),
  );

  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">IDENTITY & ACCESS CONTROL</span>
          <h2>Give every staff member and tenant only the access they need.</h2>
          <p>
            Accounts use the signed-in email address. Manager and Director roles
            can change module-level view, create, edit, delete and approval
            permissions.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditingUser(null);
            setUserOpen(true);
          }}
        >
          + Add user
        </button>
      </section>

      <section className="module-metrics">
        <Stat value={data.users.length} label="User accounts" />
        <Stat value={data.roles.length} label="Roles" />
        <Stat
          value={data.users.filter((user) => user.status === "active").length}
          label="Active users"
        />
        <Stat
          value={data.users.filter((user) => user.studentId).length}
          label="Tenant accounts"
        />
      </section>

      <section className="workspace panel">
        <div className="workspace-tabs">
          <button
            className={tab === "users" ? "active" : ""}
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            className={tab === "roles" ? "active" : ""}
            onClick={() => setTab("roles")}
          >
            Role permissions
          </button>
          <button
            className={tab === "reminders" ? "active" : ""}
            onClick={() => setTab("reminders")}
          >
            Reminder messages
          </button>
        </div>

        {tab === "users" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email / login</th>
                  <th>Role</th>
                  <th>Linked tenant</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => {
                  const role = data.roles.find(
                    (item) => item.id === user.roleId,
                  );
                  const student = data.students.find(
                    (item) => item.id === user.studentId,
                  );
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.displayName}</strong>
                      </td>
                      <td>{user.email}</td>
                      <td>{role?.name || "Not assigned"}</td>
                      <td>
                        {student
                          ? `${student.fullName} · ${student.roomCode || "No room"}`
                          : "-"}
                      </td>
                      <td>
                        <span className={`status-pill ${user.status}`}>
                          {titleCase(user.status)}
                        </span>
                      </td>
                      <td>
                        <div className="button-row">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditingUser(user);
                              setUserOpen(true);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="secondary compact"
                            onClick={() => setPasswordUser(user)}
                          >
                            Set password
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "roles" && (
          <div className="permission-workspace">
            <div className="filters">
              <label>
                Role
                <select
                  value={selectedRole?.id || ""}
                  onChange={(event) =>
                    setSelectedRoleId(Number(event.target.value))
                  }
                >
                  {data.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filter-explanation">
                <strong>{selectedRole?.name}</strong>
                <span>{selectedRole?.description}</span>
              </div>
            </div>
            <div className="table-wrap permission-table">
              <table>
                <thead>
                  <tr>
                    <th>Module / information category</th>
                    <th>View</th>
                    <th>Create</th>
                    <th>Edit</th>
                    <th>Delete</th>
                    <th>Approve</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rolePermissions.map((permission) => (
                    <tr key={permission.id}>
                      <td>
                        <strong>
                          {moduleLabels[permission.moduleKey] ||
                            titleCase(permission.moduleKey)}
                        </strong>
                      </td>
                      {(
                        [
                          "canView",
                          "canCreate",
                          "canEdit",
                          "canDelete",
                          "canApprove",
                        ] as const
                      ).map((field) => (
                        <td key={field}>
                          <input
                            form={`permission-${permission.id}`}
                            type="checkbox"
                            name={field}
                            defaultChecked={Boolean(permission[field])}
                          />
                        </td>
                      ))}
                      <td>
                        <form
                          id={`permission-${permission.id}`}
                          onSubmit={async (event) => {
                            event.preventDefault();
                            await save(
                              {
                                action: "role-permission",
                                roleId: selectedRole.id,
                                moduleKey: permission.moduleKey,
                                ...formValues(event),
                              },
                              `${selectedRole.name} permission updated`,
                            );
                          }}
                        >
                          <button className="secondary compact" disabled={busy}>
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="role-manager">
              <div className="section-title">
                <div>
                  <small>ROLE LIST</small>
                  <h3>Add, rename or remove roles</h3>
                </div>
              </div>
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    editingRole
                      ? {
                          action: "role-update",
                          roleId: editingRole.id,
                          ...formValues(event),
                        }
                      : { action: "role-create", ...formValues(event) },
                    editingRole ? "Role updated" : "Role added",
                  );
                  if (ok) {
                    setEditingRole(null);
                    (event.target as HTMLFormElement).reset();
                  }
                }}
              >
                <label>
                  Role name
                  <input
                    name="name"
                    required
                    key={`role-name-${editingRole?.id || "new"}`}
                    defaultValue={editingRole?.name || ""}
                  />
                </label>
                <label>
                  Description
                  <input
                    name="description"
                    key={`role-desc-${editingRole?.id || "new"}`}
                    defaultValue={editingRole?.description || ""}
                  />
                </label>
                <div className="form-actions wide">
                  {editingRole && (
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setEditingRole(null)}
                    >
                      Cancel edit
                    </button>
                  )}
                  <button className="primary compact" disabled={busy}>
                    {editingRole ? "Save role" : "+ Add role"}
                  </button>
                </div>
              </form>
              <div className="compact-list">
                {data.roles.map((role) => (
                  <span key={role.id}>
                    <b>{role.name}</b>
                    <small>
                      {role.isSystem ? "Built-in role" : "Custom role"}
                    </small>
                    {!role.isSystem && (
                      <div className="button-row">
                        <button
                          className="secondary compact"
                          onClick={() => setEditingRole(role)}
                        >
                          Edit
                        </button>
                        <button
                          className="secondary compact"
                          onClick={() =>
                            save(
                              { action: "role-delete", roleId: role.id },
                              "Role removed",
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "reminders" && (
          <div className="settings-grid">
            {data.reminderTemplates.map((template) => (
              <form
                className="settings-card"
                key={template.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  await save(
                    {
                      action: "reminder-template",
                      templateId: template.id,
                      ...formValues(event),
                    },
                    "Reminder message updated",
                  );
                }}
              >
                <div className="card-title">
                  <div>
                    <small>{template.templateKey}</small>
                    <h3>Day {template.dayOfMonth}</h3>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={template.enabled}
                    />{" "}
                    Enabled
                  </label>
                </div>
                <label>
                  Day of month
                  <input
                    name="dayOfMonth"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={template.dayOfMonth}
                  />
                </label>
                <label>
                  Email subject
                  <input
                    name="subject"
                    required
                    defaultValue={template.subject}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    name="message"
                    required
                    defaultValue={template.message}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save template
                </button>
              </form>
            ))}
            <div className="settings-note">
              <strong>Reminder schedule</strong>
              <p>
                The system prepares reminders on the 5th, 8th, 15th, 18th and
                21st until payment is received. Sending email requires the
                company email provider to be connected during production setup.
              </p>
            </div>
          </div>
        )}
      </section>

      {userOpen && (
        <Modal
          title={editingUser ? "Edit user account" : "Add user account"}
          kicker="USER MANAGEMENT"
          description="The login email must match the email used to sign in. Tenant accounts can be linked to one student profile."
          onClose={() => setUserOpen(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                {
                  action: "user-save",
                  userId: editingUser?.id,
                  ...formValues(event),
                },
                editingUser ? "User updated" : "User created",
              );
              if (ok) setUserOpen(false);
            }}
          >
            <label>
              Display name
              <input
                name="displayName"
                required
                defaultValue={editingUser?.displayName || ""}
              />
            </label>
            <label>
              Login email
              <input
                name="email"
                type="email"
                required
                defaultValue={editingUser?.email || ""}
              />
            </label>
            <label>
              Role
              <select
                name="roleId"
                required
                defaultValue={editingUser?.roleId || ""}
              >
                <option value="">Select role</option>
                {data.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingUser?.status || "active"}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="wide">
              Linked tenant (tenant role only)
              <SearchSelect
                name="studentId"
                defaultValue={editingUser?.studentId}
                options={data.students
                  .filter((student) => student.profileStatus === "active")
                  .map((student) => ({
                    value: student.id,
                    label: `${student.fullName} · ${student.roomCode || "No room"} · ${student.email || "No email"}`,
                  }))}
                placeholder="Type student name, email or room code"
              />
            </label>
            <div className="form-actions wide">
              <button
                type="button"
                className="secondary"
                onClick={() => setUserOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Save user"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {passwordUser && (
        <Modal
          title="Set login password"
          kicker={passwordUser.email}
          description="The account can sign in with this password immediately. Any existing sessions are signed out."
          onClose={() => setPasswordUser(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                {
                  action: "user-set-password",
                  userId: passwordUser.id,
                  ...formValues(event),
                },
                "Password updated",
              );
              if (ok) setPasswordUser(null);
            }}
          >
            <label className="wide">
              New password (minimum 8 characters)
              <input
                name="password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </label>
            <div className="form-actions wide">
              <button
                type="button"
                className="secondary"
                onClick={() => setPasswordUser(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Set password
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
