import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import './MainLayout.css';

export default function MainLayout({ children }) {
  const { user, roles, logout, hasRole, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  /**
   * Generar menú dinámico según rol y permisos
   */
  const getMenuItems = () => {
    const items = [];

    // MENÚ COMÚN (Todos)
    items.push({
      label: 'Dashboard',
      path: '/dashboard',
      icon: '📊',
      permission: 'auth:login',
      submenu: null,
    });

    items.push({
      label: 'Mi Perfil',
      path: '/profile',
      icon: '👤',
      permission: 'profile:view_own',
      submenu: null,
    });

    // MENÚ PASAJERO
    if (hasRole('passenger')) {
      items.push({
        label: 'Mis Reservas',
        path: '/passenger',
        icon: '🎫',
        permission: 'reservation:view_own',
        submenu: [
          { label: 'Ver mis reservas', path: '/passenger/reservations', permission: 'reservation:view_own' },
          { label: 'Nueva reserva', path: '/passenger/reservations/new', permission: 'reservation:create' },
        ],
      });
    }

    // MENÚ EMPLEADO
    if (hasRole('counter_employee')) {
      items.push({
        label: 'Gestión',
        path: '/employee',
        icon: '⚙️',
        permission: 'reservation:view_all',
        submenu: [
          { label: 'Todas las reservas', path: '/employee/reservations', permission: 'reservation:view_all' },
          { label: 'Procesar pagos', path: '/employee/payments', permission: 'payment:process' },
          { label: 'Reportes', path: '/employee/reports', permission: 'report:view_operational' },
        ],
      });
    }

    // MENÚ ADMIN
    if (hasRole('admin')) {
      items.push({
        label: 'Administración',
        path: '/admin',
        icon: '🔧',
        permission: 'admin:panel_access',
        submenu: [
          { label: 'Panel de Control', path: '/admin/dashboard', permission: 'admin:panel_access' },
          { label: 'Gestionar Usuarios', path: '/admin/users', permission: 'user:list' },
          { label: 'Reportes Financieros', path: '/admin/reports', permission: 'report:view_financial' },
          { label: 'Auditoría', path: '/admin/audit', permission: 'admin:view_audit' },
        ],
      });
    }

    // Filtrar solo items con permisos
    return items.filter(item => hasPermission(item.permission));
  };

  const menuItems = getMenuItems();

  const isActive = (path) => {
    return location.pathname.startsWith(path);
  };

  const getRoleLabel = (roleName) => {
    const labels = {
      passenger: '👤 Pasajero',
      counter_employee: '💼 Empleado',
      admin: '🔐 Administrador',
    };
    return labels[roleName] || roleName;
  };

  return (
    <div className="layout-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h1 className="logo">🚌 Sistema Transporte</h1>
          <button
            className="toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item, index) => (
            <div key={index} className="nav-item-wrapper">
              <a
                href={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                {sidebarOpen && <span className="nav-label">{item.label}</span>}
              </a>

              {/* Submenu */}
              {item.submenu && sidebarOpen && (
                <div className="submenu">
                  {item.submenu
                    .filter(sub => hasPermission(sub.permission))
                    .map((subitem, subindex) => (
                      <a
                        key={subindex}
                        href={subitem.path}
                        className={`submenu-item ${isActive(subitem.path) ? 'active' : ''}`}
                      >
                        {subitem.label}
                      </a>
                    ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* User Info */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-role">
              {roles.length > 0 ? getRoleLabel(roles[0].name) : 'Sin rol'}
            </div>
            <div className="user-name">{user?.firstName} {user?.lastName}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <button
              className="mobile-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>
            <h2 className="page-title">
              {roles.length > 0 ? `Bienvenido, ${user?.firstName}` : 'Dashboard'}
            </h2>
          </div>
          <div className="header-right">
            <div className="status-indicator">
              <span className="status-dot"></span>
              Conectado
            </div>
          </div>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
