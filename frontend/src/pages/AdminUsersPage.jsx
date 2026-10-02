import { useCallback, useEffect, useState } from 'react';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';
import { Permissions, Roles } from '../security/Authorization';

const emptyForm = { email: '', password: '', firstName: '', lastName: '', phone: '', role: Roles.PASSENGER };

export default function AdminUsersPage() {
  const { request, hasPermission } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

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
            <option value={Roles.PASSENGER}>Pasajero</option>
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
              <td className="p-3">{hasPermission(Permissions.USER_EDIT) && <button onClick={() => toggleActive(user)} className="text-blue-700 underline">{user.active ? 'Desactivar' : 'Activar'}</button>}</td>
            </tr>)}</tbody>
          </table>}
        </div>
      </section>
    </MainLayout>
  );
}
