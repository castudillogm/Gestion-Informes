import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { LogOut, Settings, Plus, FileText, Calendar, Edit } from 'lucide-react';

export default function Dashboard({ user }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const q = query(
          collection(db, 'reports'),
          where('userId', '==', user.uid)
        );
        const querySnapshot = await getDocs(q);
        const reportsData = [];
        querySnapshot.forEach((doc) => {
          reportsData.push({ id: doc.id, ...doc.data() });
        });
        
        // Ordenar en el cliente (evita el error de índice compuesto de Firestore)
        reportsData.sort((a, b) => {
          const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
          const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
          return timeB - timeA;
        });

        setReports(reportsData);
      } catch (error) {
        console.error("Error fetching reports:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, [user]);

  const handleLogout = () => {
    signOut(auth);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Desconocida';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new Intl.DateTimeFormat('es-ES', { 
      day: '2-digit', month: '2-digit', year: 'numeric', 
      hour: '2-digit', minute: '2-digit' 
    }).format(date);
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <img src="/Logo.png" alt="Grupamar" style={{height: '40px'}} onError={(e) => {e.target.style.display='none'; e.target.nextSibling.style.display='block'}} />
          <span style={{display: 'none', fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--primary-color)'}}>Gestor de Informes</span>
        </div>
        <div className="navbar-actions">
          <Link to="/settings" className="btn btn-secondary" style={{padding: '0.5rem', borderRadius: '50%'}} title="Configuración">
            <Settings size={20} />
          </Link>
          <div className="user-info">
            <img src={user.photoURL || 'https://ui-avatars.com/api/?name='+user.email} alt="User" className="user-avatar" />
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <span style={{fontSize: '0.9rem', fontWeight: 600}}>{user.displayName || 'Usuario'}</span>
              <span style={{fontSize: '0.75rem', color: 'var(--text-light)'}}>{user.email}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="btn btn-danger" style={{padding: '0.5rem', borderRadius: '50%'}} title="Cerrar sesión">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="page-container">
        <div className="page-header">
          <h1 className="page-title">Mis Informes</h1>
          <button onClick={() => navigate('/report/new')} className="btn btn-primary">
            <Plus size={20} /> Nuevo Informe
          </button>
        </div>

        {loading ? (
          <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-light)'}}>Cargando informes...</div>
        ) : reports.length === 0 ? (
          <div className="glass-panel" style={{textAlign: 'center', padding: '4rem 2rem'}}>
            <FileText size={64} color="var(--secondary-color)" style={{marginBottom: '1rem', opacity: 0.5}} />
            <h3 style={{marginBottom: '0.5rem'}}>No tienes informes aún</h3>
            <p style={{color: 'var(--text-light)', marginBottom: '1.5rem'}}>Crea tu primer informe para comenzar a gestionar tus análisis.</p>
            <button onClick={() => navigate('/report/new')} className="btn btn-primary">
              <Plus size={20} /> Crear el primero
            </button>
          </div>
        ) : (
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem'}}>
            {reports.map(report => (
              <div key={report.id} className="glass-panel" style={{padding: '1.5rem', display: 'flex', flexDirection: 'column'}}>
                <h3 style={{fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--primary-color)'}}>{report.title || 'Informe sin título'}</h3>
                
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '0.5rem'}}>
                  <Calendar size={14} /> Creado: {formatDate(report.createdAt)}
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '1.5rem'}}>
                  <Edit size={14} /> Editado: {formatDate(report.updatedAt)}
                </div>
                
                <div style={{marginTop: 'auto', display: 'flex', gap: '0.5rem'}}>
                  <button onClick={() => navigate(`/report/${report.id}`)} className="btn btn-secondary" style={{flex: 1, padding: '0.5rem'}}>
                    Abrir / Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
