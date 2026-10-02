import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Roles } from '../security/Authorization';

export default function LoginPage() {
  const { login, isAuthenticated, roles, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) {
    if (roles.some((role) => role.name === Roles.ADMIN)) return <Navigate to="/admin/dashboard" replace />;
    if (roles.some((role) => role.name === Roles.EMPLOYEE)) return <Navigate to="/employee" replace />;
    return <Navigate to="/passenger" replace />;
  }

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await login(form.email, form.password);
      const roleNames = (session.roles || []).map((role) => role.name);
      navigate(roleNames.includes(Roles.ADMIN) ? '/admin/dashboard' : roleNames.includes(Roles.EMPLOYEE) ? '/employee' : '/passenger', { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto mt-12 max-w-md rounded-lg bg-white p-8 shadow">
      <h1 className="mb-6 text-2xl font-semibold">Iniciar sesión</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">Email<input className="mt-1 block w-full rounded border p-2" name="email" type="email" autoComplete="email" required value={form.email} onChange={update} /></label>
        <label className="block">Contraseña<input className="mt-1 block w-full rounded border p-2" name="password" type="password" autoComplete="current-password" required value={form.password} onChange={update} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="w-full rounded bg-blue-700 p-2 font-medium text-white disabled:opacity-60" type="submit" disabled={submitting}>{submitting ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
      <p className="mt-5 text-sm">¿No tenés cuenta? <Link className="text-blue-700 underline" to="/register">Crear cuenta de pasajero</Link></p>
    </main>
  );
}
