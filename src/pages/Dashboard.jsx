import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { LogOut, Settings, Plus, FileText, Calendar, Edit, CheckSquare, Square, X, Download, Sparkles } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { jsPDF } from 'jspdf';

export default function Dashboard({ user }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [selectedReports, setSelectedReports] = useState([]);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  
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
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
      alert("Error al generar el resumen. Revisa tu conexión y API Key.");
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
            {reports.map(report => (
              <div key={report.id} className="glass-panel" style={{padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem'}}>
                
                <div style={{display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1}}>
                  <h3 style={{fontSize: '1.1rem', margin: 0, color: 'var(--primary-color)'}}>{report.title || 'Informe sin título'}</h3>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--text-light)'}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold'}}>
                      <Calendar size={14} /> Fecha del Informe: {report.reportDate ? new Date(report.reportDate).toLocaleDateString('es-ES') : 'No especificada'}
                    </span>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><Edit size={14} /> Modificado: {formatDate(report.updatedAt)}</span>
                  </div>
                </div>
                
                <button onClick={() => navigate(`/report/${report.id}`)} className="btn btn-secondary" style={{padding: '0.6rem 1.2rem', whiteSpace: 'nowrap'}}>
                  Abrir / Editar
                </button>
              </div>
            ))}
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
    </div>
  );
}
