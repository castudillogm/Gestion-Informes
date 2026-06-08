import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, orderBy, updateDoc, doc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { LogOut, Settings, Plus, FileText, Calendar, Edit, CheckSquare, Square, X, Download, Sparkles, Share2, Users, Link as LinkIcon } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsPDF } from 'jspdf';

export default function Dashboard({ user }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [selectedReports, setSelectedReports] = useState([]);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  
  // Share Modal States
  const [shareReport, setShareReport] = useState(null);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('editor');
  
  const navigate = useNavigate();

  useEffect(() => {
    const fetchReports = async () => {
      try {
        // Buscar informes propios
        const q1 = query(
          collection(db, 'reports'),
          where('userId', '==', user.uid)
        );
        
        // Buscar informes compartidos con mi email
        const q2 = query(
          collection(db, 'reports'),
          where('collaborators', 'array-contains', user.email)
        );

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        const reportsMap = new Map();
        snap1.forEach((doc) => reportsMap.set(doc.id, { id: doc.id, ...doc.data() }));
        snap2.forEach((doc) => reportsMap.set(doc.id, { id: doc.id, ...doc.data() }));
        
        const reportsData = Array.from(reportsMap.values());
        
        // Ordenar en el cliente
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

  const handleSelectReport = (reportId) => {
    setSelectedReports(prev => 
      prev.includes(reportId) ? prev.filter(id => id !== reportId) : [...prev, reportId]
    );
  };

  const generateSummary = async () => {
    if (selectedReports.length === 0) {
      alert("Selecciona al menos un informe para resumir.");
      return;
    }

    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      alert("No se ha configurado la API Key de Gemini. Ve a Configuración.");
      return;
    }

    setGeneratingSummary(true);
    setSummaryText('');

    try {
      const genAI = new GoogleGenerativeAI(apiKey.trim());

      // Obtener lista de modelos disponibles para esta API Key
      const modelsResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`);
      if (!modelsResponse.ok) throw new Error("No se pudo conectar para obtener los modelos.");
      const modelsData = await modelsResponse.json();
      
      let targetModel = modelsData.models?.find(m => m.name.includes("flash") && m.supportedGenerationMethods?.includes("generateContent"));
      if (!targetModel) targetModel = modelsData.models?.find(m => m.name.includes("pro") && m.supportedGenerationMethods?.includes("generateContent"));
      if (!targetModel) targetModel = modelsData.models?.find(m => m.supportedGenerationMethods?.includes("generateContent"));
      
      if (!targetModel) throw new Error("No hay modelos de generación de texto disponibles para tu cuenta.");
      
      const modelName = targetModel.name.replace("models/", "");
      console.log("Usando modelo:", modelName);
      const model = genAI.getGenerativeModel({ model: modelName });

      // Gather content from selected reports
      const selectedDocs = reports.filter(r => selectedReports.includes(r.id));
      
      // Sort by date
      selectedDocs.sort((a, b) => {
        const dateA = a.reportDate ? new Date(a.reportDate).getTime() : 0;
        const dateB = b.reportDate ? new Date(b.reportDate).getTime() : 0;
        return dateA - dateB;
      });

      let contentToSummarize = "";
      selectedDocs.forEach(report => {
        const reportDate = report.reportDate ? new Date(report.reportDate).toLocaleDateString('es-ES') : "Fecha desconocida";
        contentToSummarize += `\n\n=== INFORME: ${report.title || 'Sin título'} (Fecha: ${reportDate}) ===\n`;
        if (report.sections && report.sections.length > 0) {
          report.sections.forEach((sec, idx) => {
            const comment = sec.formalComment || sec.originalComment || "Sin comentarios.";
            const sectionTitle = sec.title !== undefined ? sec.title : 'Apartado';
            contentToSummarize += `- ${sectionTitle} ${idx + 1}: ${comment}\n`;
          });
        } else {
          contentToSummarize += "Sin contenido en el informe.\n";
        }
      });

      const prompt = `Actúa como un experto redactor de informes técnicos. Te proporcionaré los contenidos de varios informes diarios de un inspector o supervisor. 
Tu tarea es crear un único Resumen General claro, profesional y bien estructurado que agrupe los puntos más importantes de estos informes. 
Organiza la información de forma cronológica por informe y por fecha del informe. Resalta los aspectos más críticos o las conclusiones más relevantes.

TEXTO DE LOS INFORMES SELECCIONADOS:
${contentToSummarize}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      setSummaryText(text);
    } catch (error) {
      console.error("Error al generar resumen:", error);
      alert(`Error al generar el resumen: ${error.message || error}. Por favor, verifica tu conexión y que tu API Key sea correcta.`);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const downloadSummaryPDF = () => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const margin = 20;
      let yPosition = margin;
      const pageWidth = pdf.internal.pageSize.width;
      const maxWidth = pageWidth - (margin * 2);

      pdf.setFontSize(18);
      pdf.setTextColor(44, 62, 80);
      pdf.text("Resumen General de Informes", margin, yPosition);
      yPosition += 15;

      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Fecha de generación: ${new Date().toLocaleDateString('es-ES')}`, margin, yPosition);
      yPosition += 15;

      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);

      const textLines = pdf.splitTextToSize(summaryText, maxWidth);
      
      textLines.forEach(line => {
        if (yPosition > pdf.internal.pageSize.height - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 7;
      });

      pdf.save(`Resumen_General_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.pdf`);
    } catch (error) {
      console.error("Error generando PDF:", error);
      alert("Hubo un error al crear el archivo PDF.");
    }
  };

  const handleShare = async () => {
    if (!shareEmail.trim() || !shareReport) return;
    const email = shareEmail.trim().toLowerCase();
    
    const newCollaborators = [...(shareReport.collaborators || [])];
    if (!newCollaborators.includes(email)) newCollaborators.push(email);
    
    const newRoles = { ...(shareReport.roles || {}) };
    newRoles[email] = shareRole;

    try {
      await updateDoc(doc(db, 'reports', shareReport.id), {
        collaborators: newCollaborators,
        roles: newRoles
      });
      
      // Update local state
      setReports(reports.map(r => r.id === shareReport.id ? { ...r, collaborators: newCollaborators, roles: newRoles } : r));
      setShareReport({ ...shareReport, collaborators: newCollaborators, roles: newRoles });
      setShareEmail('');
      alert("Usuario invitado correctamente.");
    } catch (e) {
      alert("Error al compartir.");
    }
  };
  
  const handlePublicAccessChange = async (e) => {
    if (!shareReport) return;
    const val = e.target.value;
    try {
      await updateDoc(doc(db, 'reports', shareReport.id), { publicAccess: val });
      setReports(reports.map(r => r.id === shareReport.id ? { ...r, publicAccess: val } : r));
      setShareReport({ ...shareReport, publicAccess: val });
    } catch (e) {
      alert("Error al cambiar acceso.");
    }
  };
  
  const copyLink = () => {
    if (!shareReport) return;
    const url = `${window.location.origin}/report/${shareReport.id}`;
    navigator.clipboard.writeText(url);
    alert("Enlace copiado al portapapeles.");
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
        <div className="page-header" style={{display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between'}}>
          <h1 className="page-title">Mis Informes</h1>
          <div style={{display: 'flex', gap: '1rem'}}>
            <button onClick={() => { setShowSummaryModal(true); setSelectedReports([]); setSummaryText(''); }} className="btn btn-secondary">
              <Sparkles size={20} /> Generar Resumen General
            </button>
            <button onClick={() => navigate('/report/new')} className="btn btn-primary">
              <Plus size={20} /> Nuevo Informe
            </button>
          </div>
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
          <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
            {reports.map(report => {
              let role = 'Propietario';
              if (report.userId !== user.uid) {
                role = report.roles && report.roles[user.email] === 'editor' ? 'Editor' : 'Lector';
              }
              
              return (
                <div key={report.id} className="glass-panel" style={{padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem'}}>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <h3 style={{fontSize: '1.1rem', margin: 0, color: 'var(--primary-color)'}}>{report.title || 'Informe sin título'}</h3>
                      <span style={{
                        background: role === 'Propietario' ? 'var(--secondary-color)' : (role === 'Editor' ? '#4CAF50' : '#FF9800'),
                        color: 'white', padding: '0.1rem 0.5rem', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold'
                      }}>
                        {role}
                      </span>
                    </div>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--text-light)'}}>
                      <span style={{display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold'}}>
                        <Calendar size={14} /> Fecha del Informe: {report.reportDate ? new Date(report.reportDate).toLocaleDateString('es-ES') : 'No especificada'}
                      </span>
                      <span style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><Edit size={14} /> Modificado: {formatDate(report.updatedAt)}</span>
                    </div>
                  </div>
                  
                  <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                    {role === 'Propietario' && (
                      <button onClick={() => setShareReport(report)} className="btn btn-secondary" style={{padding: '0.4rem 0.6rem', fontSize: '0.85rem', color: 'var(--primary-color)', borderColor: 'var(--primary-color)'}}>
                        <Share2 size={16} /> Compartir
                      </button>
                    )}
                    <button onClick={() => navigate(`/report/${report.id}`)} className="btn btn-secondary" style={{padding: '0.4rem 0.8rem', fontSize: '0.85rem', whiteSpace: 'nowrap'}}>
                      {role === 'Lector' ? 'Ver' : 'Editar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal Resumen General */}
      {showSummaryModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto',
            padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem',
            backgroundColor: '#ffffff'
          }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <h2 style={{margin: 0, color: 'var(--primary-color)'}}>Resumen General de Informes</h2>
              <button onClick={() => setShowSummaryModal(false)} style={{background: 'none', border: 'none', cursor: 'pointer'}}>
                <X size={24} color="#666" />
              </button>
            </div>

            {summaryText ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <div style={{
                  padding: '1.5rem', backgroundColor: '#f8f9fa', 
                  borderRadius: '8px', borderLeft: '4px solid var(--primary-color)',
                  whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif',
                  maxHeight: '50vh', overflowY: 'auto'
                }}>
                  {summaryText}
                </div>
                <div style={{display: 'flex', gap: '1rem', justifyContent: 'flex-end'}}>
                  <button onClick={() => setShowSummaryModal(false)} className="btn btn-secondary">
                    Cerrar
                  </button>
                  <button onClick={downloadSummaryPDF} className="btn btn-primary">
                    <Download size={18} /> Descargar PDF
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <p style={{marginBottom: '1rem', color: 'var(--text-light)'}}>Selecciona los informes que deseas incluir en el resumen general:</p>
                  
                  {reports.length === 0 ? (
                    <p style={{textAlign: 'center', padding: '2rem'}}>No hay informes disponibles.</p>
                  ) : (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '40vh', overflowY: 'auto'}}>
                      {reports.map(report => (
                        <div 
                          key={report.id} 
                          onClick={() => handleSelectReport(report.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '1rem', 
                            padding: '1rem', border: '1px solid #ddd', borderRadius: '8px',
                            cursor: 'pointer', backgroundColor: selectedReports.includes(report.id) ? '#f0f7ff' : 'white',
                            borderColor: selectedReports.includes(report.id) ? 'var(--primary-color)' : '#ddd'
                          }}
                        >
                          {selectedReports.includes(report.id) ? (
                            <CheckSquare size={24} color="var(--primary-color)" />
                          ) : (
                            <Square size={24} color="#ccc" />
                          )}
                          <div style={{flex: 1}}>
                            <h4 style={{margin: '0 0 0.3rem 0'}}>{report.title || 'Sin título'}</h4>
                            <span style={{fontSize: '0.85rem', color: 'var(--text-light)'}}>
                              Fecha del Informe: {report.reportDate ? new Date(report.reportDate).toLocaleDateString('es-ES') : 'No especificada'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem'}}>
                  <button onClick={() => setShowSummaryModal(false)} className="btn btn-secondary">
                    Cancelar
                  </button>
                  <button 
                    onClick={generateSummary} 
                    disabled={generatingSummary || selectedReports.length === 0} 
                    className="btn btn-primary"
                  >
                    {generatingSummary ? 'Generando...' : <><Sparkles size={18} /> Crear Resumen con IA</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal Compartir (Dashboard) */}
      {shareReport && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
        }}>
          <div className="glass-panel" style={{width: '100%', maxWidth: '500px', backgroundColor: 'white', padding: '2rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <h2 style={{margin: 0, color: 'var(--primary-color)'}}><Users size={24} style={{verticalAlign: 'middle', marginRight: '0.5rem'}} /> Compartir Informe</h2>
              <button onClick={() => setShareReport(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}>
                <X size={24} color="#666" />
              </button>
            </div>
            
            <div style={{marginBottom: '2rem'}}>
              <label className="form-label">Invitar por correo electrónico</label>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <input 
                  type="email" 
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  placeholder="ejemplo@gmail.com" 
                  className="form-control" 
                />
                <select value={shareRole} onChange={e => setShareRole(e.target.value)} className="form-control" style={{width: 'auto'}}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Lector</option>
                </select>
                <button onClick={handleShare} className="btn btn-primary">Invitar</button>
              </div>
            </div>

            <div style={{marginBottom: '2rem'}}>
              <label className="form-label">Acceso General</label>
              <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                <div style={{flex: 1}}>
                  <select value={shareReport.publicAccess || 'restricted'} onChange={handlePublicAccessChange} className="form-control">
                    <option value="restricted">Restringido (Solo invitados)</option>
                    <option value="viewer">Cualquier persona con el enlace (Lector)</option>
                    <option value="editor">Cualquier persona con el enlace (Editor)</option>
                  </select>
                </div>
                <button onClick={copyLink} className="btn btn-secondary" style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                  <LinkIcon size={16} /> Copiar Enlace
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Personas con acceso</label>
              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '0.5rem', borderBottom: '1px solid #eee'}}>
                  <span>{shareReport.userId === user.uid ? user.email : shareReport.userId} <strong>(Propietario)</strong></span>
                  <span style={{color: 'var(--text-light)'}}>Propietario</span>
                </div>
                {shareReport.collaborators?.map(email => (
                  <div key={email} style={{display: 'flex', justifyContent: 'space-between', padding: '0.5rem', borderBottom: '1px solid #eee'}}>
                    <span>{email}</span>
                    <span style={{color: 'var(--text-light)'}}>{shareReport.roles?.[email] === 'editor' ? 'Editor' : 'Lector'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '2rem'}}>
              <button onClick={() => setShareReport(null)} className="btn btn-primary">Hecho</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
