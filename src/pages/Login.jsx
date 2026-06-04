import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/');
    } catch (error) {
      console.error("Error signing in with Google:", error);
      // En un entorno de producción, mostrar un toast o alerta amigable.
      alert("Error al iniciar sesión. Comprueba que Firebase esté configurado correctamente.");
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
      {/* Lado izquierdo - Diseño visual */}
      <div style={{
        flex: 1, 
        background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        color: 'white',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: 800 }}>Gestor de Informes</h1>
        <p style={{ fontSize: '1.2rem', maxWidth: '400px', opacity: 0.9 }}>
          Sistema inteligente para la creación y gestión de informes técnicos con Inteligencia Artificial.
        </p>
      </div>

      {/* Lado derecho - Login */}
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem'
      }}>
        <div className="glass-panel" style={{ padding: '3rem', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
          <img src="/Logo.png" alt="Grupamar Logo" style={{ height: '60px', marginBottom: '2rem' }} onError={(e) => e.target.style.display = 'none'} />
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Bienvenido</h2>
          <p style={{ color: 'var(--text-light)', marginBottom: '2rem' }}>Inicia sesión para continuar</p>
          
          <button onClick={handleGoogleLogin} className="btn btn-primary" style={{ width: '100%', display: 'flex', gap: '10px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar con Google
          </button>
        </div>
      </div>
    </div>
  );
}
