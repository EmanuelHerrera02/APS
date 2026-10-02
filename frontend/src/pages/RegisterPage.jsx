import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterPage() {
  const { register, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await register({ ...form, phone: form.phone.trim() || null });
      if (session.accessToken) navigate('/passenger', { replace: true });
      else {
        await login(form.email, form.password);
        navigate('/passenger', { replace: true });
      }
    } catch (registrationError) {
      setError(registrationError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto mt-12 max-w-md rounded-lg bg-white p-8 shadow">
      <h1 className="mb-6 text-2xl font-semibold">Crear cuenta de pasajero</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">Nombre<input className="mt-1 block w-full rounded border p-2" name="firstName" autoComplete="given-name" required maxLength="100" value={form.firstName} onChange={update} /></label>
        <label className="block">Apellido<input className="mt-1 block w-full rounded border p-2" name="lastName" autoComplete="family-name" required maxLength="100" value={form.lastName} onChange={update} /></label>
        <label className="block">Email<input className="mt-1 block w-full rounded border p-2" name="email" type="email" autoComplete="email" required maxLength="255" value={form.email} onChange={update} /></label>
        <label className="block">Contraseña<input className="mt-1 block w-full rounded border p-2" name="password" type="password" autoComplete="new-password" minLength="8" maxLength="256" required value={form.password} onChange={update} /></label>
        <label className="block">Teléfono (opcional)<input className="mt-1 block w-full rounded border p-2" name="phone" type="tel" autoComplete="tel" maxLength="30" value={form.phone} onChange={update} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="w-full rounded bg-blue-700 p-2 font-medium text-white disabled:opacity-60" type="submit" disabled={submitting}>{submitting ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
      <p className="mt-5 text-sm">¿Ya tenés cuenta? <Link className="text-blue-700 underline" to="/login">Iniciar sesión</Link></p>
    </main>
  );
}
