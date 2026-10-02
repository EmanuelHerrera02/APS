import { useEffect, useState } from 'react';
import MainLayout from '../components/layouts/MainLayout';
import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { request } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/passenger/profile')
      .then((data) => setProfile(data.profile))
      .catch((loadError) => setError(loadError.message));
  }, [request]);
  return <MainLayout><section className="rounded bg-white p-6">
    <h2 className="mb-4 text-xl font-semibold">Mi perfil</h2>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!profile && !error && <p>Cargando perfil…</p>}
    {profile && <dl className="grid gap-3 sm:grid-cols-2">
      <dt>Nombre</dt><dd>{profile.firstName} {profile.lastName}</dd>
      <dt>Email</dt><dd>{profile.email}</dd><dt>Teléfono</dt><dd>{profile.phone || '—'}</dd>
      <dt>Perfil</dt><dd>{profile.role}</dd><dt>Estado</dt><dd>{profile.active ? 'Activo' : 'Inactivo'}</dd>
    </dl>}
  </section></MainLayout>;
}
