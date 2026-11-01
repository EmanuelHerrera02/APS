import React from 'react';
import { useCallback, useEffect, useState } from 'react';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { Permissions, Roles } from '../security/Authorization';

const emptyForm = { email: '', password: '', firstName: '', lastName: '', phone: '', role: Roles.EMPLOYEE };

export default function AdminUsersPage() {
  const { request, hasPermission } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await request('/admin/users');
      setUsers(response.users || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const createUser = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await request('/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setForm(emptyForm);
      setMessage('Usuario creado.');
      await loadUsers();
    } catch (createError) {
      setError(createError.message);
    }
  };

  const toggleActive = async (user) => {
    setError('');
    setMessage('');
    try {
      await request(`/admin/users/${user.id}`, {
        method: 'PUT', body: JSON.stringify({ active: !user.active }),
      });
      setMessage('Estado actualizado.');
      await loadUsers();
    } catch (updateError) {
      setError(updateError.message);
    }
  };

  const beginEdit = (user) => {
    setEditing(user);
    setEditForm({ email: user.email, password: '', firstName: user.firstName || '',
      lastName: user.lastName || '', phone: user.phone || '', role: user.role });
    setError('');
    setMessage('');
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editing || !editForm) return;
    setError('');
    setMessage('');
    const { password, ...changes } = editForm;
    if (password) changes.password = password;
    try {
      await request(`/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(changes) });
      setEditing(null);
      setEditForm(null);
      setMessage('Cuenta actualizada.');
      await loadUsers();
    } catch (updateError) {
      setError(updateError.message);
    }
  };

  return (
    <MainLayout>
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">Usuarios</h2>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {message && <p role="status" className="text-green-700">{message}</p>}
        {hasPermission(Permissions.USER_CREATE) && <form onSubmit={createUser} className="grid gap-3 rounded bg-white p-5 md:grid-cols-2">
          <h3 className="font-semibold md:col-span-2">Crear usuario</h3>
          <input required type="text" placeholder="Nombre" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input required type="text" placeholder="Apellido" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input required type="password" minLength="8" placeholder="Contraseña" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <input type="tel" placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          {hasPermission(Permissions.USER_CHANGE_ROLE) && <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value={Roles.EMPLOYEE}>Empleado</option>
            <option value={Roles.ADMIN}>Administrador</option>
          </select>}
          <button type="submit" className="rounded bg-blue-700 px-4 py-2 text-white md:col-span-2">Crear cuenta</button>
        </form>}
        <div className="overflow-x-auto rounded bg-white">
          {loading ? <p className="p-5">Cargando usuarios…</p> : <table className="w-full text-left text-sm">
            <thead><tr><th className="p-3">Nombre</th><th className="p-3">Email</th><th className="p-3">Perfil</th><th className="p-3">Estado</th><th className="p-3">Acción</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id} className="border-t">
              <td className="p-3">{user.firstName} {user.lastName}</td><td className="p-3">{user.email}</td><td className="p-3">{user.role}</td>
              <td className="p-3">{user.active ? 'Activo' : 'Inactivo'}</td>
              <td className="p-3 space-x-3">{hasPermission(Permissions.USER_EDIT) && <>
                <button onClick={() => beginEdit(user)} className="text-blue-700 underline">Editar</button>
                <button onClick={() => toggleActive(user)} className="text-blue-700 underline">{user.active ? 'Desactivar' : 'Activar'}</button>
              </>}</td>
            </tr>)}</tbody>
          </table>}
        </div>
        {editing && editForm && <form onSubmit={saveEdit} className="grid gap-3 rounded bg-white p-5 md:grid-cols-2">
          <h3 className="font-semibold md:col-span-2">Editar cuenta: {editing.email}</h3>
          <label className="text-sm">Nombre<input required maxLength="100" className="mt-1 w-full rounded border p-2" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} /></label>
          <label className="text-sm">Apellido<input required maxLength="100" className="mt-1 w-full rounded border p-2" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} /></label>
          <label className="text-sm">Email<input required type="email" maxLength="255" className="mt-1 w-full rounded border p-2" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></label>
          <label className="text-sm">Nueva contraseña (opcional)<input type="password" minLength="8" maxLength="256" autoComplete="new-password" className="mt-1 w-full rounded border p-2" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} /></label>
          <label className="text-sm">Teléfono<input type="tel" maxLength="30" className="mt-1 w-full rounded border p-2" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></label>
          {hasPermission(Permissions.USER_CHANGE_ROLE) && <label className="text-sm">Perfil<select className="mt-1 w-full rounded border p-2" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
            <option value={Roles.PASSENGER}>Pasajero</option><option value={Roles.EMPLOYEE}>Empleado</option><option value={Roles.ADMIN}>Administrador</option>
          </select></label>}
          <div className="flex gap-3 md:col-span-2"><button type="submit" className="rounded bg-blue-700 px-4 py-2 text-white">Guardar cambios</button>
            <button type="button" onClick={() => { setEditing(null); setEditForm(null); }} className="rounded border px-4 py-2">Cancelar</button></div>
        </form>}
      </section>
    </MainLayout>
  );
}
