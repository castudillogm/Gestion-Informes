import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Key, Save, Book } from 'lucide-react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [glossary, setGlossary] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'globalSettings', 'config'));
        if (configSnap.exists()) {
          setApiKey(configSnap.data().geminiApiKey || '');
          setGlossary(configSnap.data().companyGlossary || '');
        } else {
          setApiKey(localStorage.getItem('geminiApiKey') || '');
          setGlossary(localStorage.getItem('companyGlossary') || '');
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    fetchConfig();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'globalSettings', 'config'), {
        geminiApiKey: apiKey,
        companyGlossary: glossary
      });
      localStorage.setItem('geminiApiKey', apiKey);
      localStorage.setItem('companyGlossary', glossary);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Error guardando config:", error);
      alert("Error al guardar la configuración global.");
    }
  };

  return (
    <div className="app-container">
      {/* Navbar Simple */}
      <nav className="navbar" style={{justifyContent: 'flex-start', gap: '1rem'}}>
        <Link to="/" className="btn btn-secondary" style={{padding: '0.5rem', borderRadius: '50%'}}>
          <ArrowLeft size={20} />
        </Link>
        <span style={{fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--primary-color)'}}>Configuración</span>
      </nav>

      <main className="page-container" style={{maxWidth: '600px'}}>
        <div className="glass-panel" style={{padding: '2rem'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem'}}>
            <Key size={32} color="var(--secondary-color)" />
            <h2 style={{margin: 0}}>API de Inteligencia Artificial</h2>
          </div>
          
          <p style={{color: 'var(--text-light)', marginBottom: '2rem'}}>
            El sistema utiliza Google Gemini para mejorar la redacción de los comentarios. 
            Introduce tu API Key aquí. Esta clave se guardará únicamente en tu navegador.
          </p>
          
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Gemini API Key</label>
              <input 
                type="password" 
                className="form-control" 
                placeholder="AIzaSy..." 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{marginTop: '2rem'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
                <Book size={20} color="var(--primary-color)" />
                <label className="form-label" style={{margin: 0}}>Glosario de la Empresa (Autoaprendizaje)</label>
              </div>
              <p style={{fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '1rem'}}>
                Escribe aquí nombres de la empresa, términos técnicos o palabras que el micrófono suele entender mal. La Inteligencia Artificial cruzará esta lista para corregir los errores de la voz automáticamente. (Ej: "Grupamar", "TDS", "análisis foliar").
              </p>
              <textarea 
                className="form-control" 
                placeholder="Grupamar, pH, conductividad eléctrica, TDS..." 
                value={glossary}
                onChange={(e) => setGlossary(e.target.value)}
                style={{minHeight: '120px'}}
              />
            </div>
            
            <button type="submit" className="btn btn-primary" style={{width: '100%', marginTop: '1.5rem'}}>
              <Save size={20} /> Guardar Configuración
            </button>
            
            {saved && (
              <div style={{marginTop: '1rem', padding: '1rem', backgroundColor: '#d4edda', color: '#155724', borderRadius: '8px', textAlign: 'center'}}>
                ¡Configuración guardada correctamente!
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
