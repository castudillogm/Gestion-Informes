import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, storage } from '../firebase';
import { doc, getDoc, setDoc, collection, addDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArrowLeft, Save, FileDown, Plus, Trash2, Image as ImageIcon, Sparkles, X, Mic, MicOff, Camera, Share2, Users, Link as LinkIcon, User } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function ReportEditor({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState({
    title: 'Nuevo Informe',
    reportDate: new Date().toISOString().split('T')[0],
    sections: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const pdfRef = useRef();

  // Collaboration states
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('editor');
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const autoSaveTimerRef = useRef(null);

  const isOwner = report.userId === user.uid || id === 'new';
  const role = isOwner ? 'owner' : (report.roles?.[user.email] || 'viewer');
  const isViewer = role === 'viewer';

  const triggerAutoSave = (newReportData) => {
    if (id === 'new') return;
    if (isViewer) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    
    setSaving(true);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, 'reports', id), {
          title: newReportData.title,
          reportDate: newReportData.reportDate,
          sections: newReportData.sections,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error('Auto-save failed', err);
      } finally {
        setSaving(false);
      }
    }, 1500);
  };

  const recognitionRef = useRef(null);
  const [listeningSection, setListeningSection] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');

  // Estados para la cámara integrada
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraSectionId, setCameraSectionId] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const openCamera = async (sectionId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Prioriza la cámara trasera
      });
      setCameraSectionId(sectionId);
      setIsCameraOpen(true);
      
      // Esperar a que React renderice el elemento <video>
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error("Error al acceder a la cámara:", err);
      alert("No se pudo acceder a la cámara. Asegúrate de haber dado los permisos necesarios en tu navegador.");
    }
  };

  const closeCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
    setCameraSectionId(null);
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current || !cameraSectionId) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Configurar el canvas al tamaño del video real
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Obtener imagen en base64 (JPEG comprimido)
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    
    // Añadir al apartado correspondiente
    updateSection(cameraSectionId, 'images', imageDataUrl, true);
    
    // Cerrar cámara
    closeCamera();
  };

  const toggleListening = (sectionId) => {
    if (listeningSection === sectionId) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setListeningSection(null);
      setInterimTranscript('');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setInterimTranscript('');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz. Te recomendamos usar Google Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let currentInterim = '';
      
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
      
      setInterimTranscript(currentInterim);

      if (finalTranscript) {
        setReport(prevReport => {
          const newSections = prevReport.sections.map(s => {
            if (s.id === sectionId) {
              const separator = (s.originalComment && !s.originalComment.endsWith(' ')) ? ' ' : '';
              return { ...s, originalComment: s.originalComment + separator + finalTranscript };
            }
            return s;
          });
          return { ...prevReport, sections: newSections };
        });
      }
    };

    recognition.onerror = (event) => {
      console.error("Error de voz:", event.error);
      setListeningSection(null);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setListeningSection(null);
      setInterimTranscript('');
    };

    recognition.start();
    recognitionRef.current = recognition;
    setListeningSection(sectionId);
  };

  useEffect(() => {
    if (id === 'new') {
      setReport({
        title: 'Nuevo Informe',
        reportDate: new Date().toISOString().split('T')[0],
        userId: user.uid,
        collaborators: [],
        roles: {},
        publicAccess: 'restricted',
        sections: [{ 
          id: Date.now().toString(), title: 'Apartado', images: [], originalComment: '', formalComment: '',
          createdBy: { name: user.displayName || 'Usuario', photoURL: user.photoURL || '', email: user.email }
        }]
      });
      setLoading(false);
      return;
    }
    
    const docRef = doc(db, 'reports', id);
    const unsubscribe = onSnapshot(docRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const isOwner = data.userId === user.uid;
        const isCollab = data.collaborators?.includes(user.email);
        
        if (!isOwner && !isCollab) {
          if (data.publicAccess === 'editor' || data.publicAccess === 'viewer') {
            const newCollabs = [...(data.collaborators || []), user.email];
            const newRoles = { ...(data.roles || {}) };
            newRoles[user.email] = data.publicAccess;
            await updateDoc(docRef, { collaborators: newCollabs, roles: newRoles });
            data.collaborators = newCollabs;
            data.roles = newRoles;
          } else {
            alert('No tienes permiso para ver este informe.');
            navigate('/');
            return;
          }
        }
        
        if (!docSnap.metadata.hasPendingWrites) {
          setReport({ id: docSnap.id, ...data });
        }
      } else {
        alert('Informe no encontrado');
        navigate('/');
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching report:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id, navigate, user.uid, user.email]);

  const handleTitleChange = (e) => {
    if (isViewer) return;
    const updated = { ...report, title: e.target.value };
    setReport(updated);
    triggerAutoSave(updated);
  };

  const handleDateChange = (e) => {
    if (isViewer) return;
    const updated = { ...report, reportDate: e.target.value };
    setReport(updated);
    triggerAutoSave(updated);
  };

  const addSection = () => {
    if (isViewer) return;
    const newSection = { 
      id: Date.now().toString(), title: 'Apartado', images: [], originalComment: '', formalComment: '',
      createdBy: { name: user.displayName || 'Usuario', photoURL: user.photoURL || '', email: user.email }
    };
    setReport(prev => {
      const updated = { ...prev, sections: [...prev.sections, newSection] };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const removeSection = (sectionId) => {
    if (isViewer) return;
    setReport(prev => {
      const updated = { ...prev, sections: prev.sections.filter(s => s.id !== sectionId) };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const handleImagePaste = (e, sectionId) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        uploadImage(blob, sectionId);
      }
    }
  };

  const handleImageSelect = (e, sectionId) => {
    const files = e.target.files;
    if (!files) return;
    
    Array.from(files).forEach(file => {
      uploadImage(file, sectionId);
    });
  };

  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1920; // Full HD para máxima nitidez
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Comprimir a JPEG con alta calidad (92%)
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const uploadImage = async (file, sectionId) => {
    try {
      setSaving(true);
      const compressedDataUrl = await compressImage(file);
      
      const response = await fetch(compressedDataUrl);
      const blob = await response.blob();
      
      const reportId = id !== 'new' ? id : 'temp_report';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
      const imageRef = ref(storage, `reports/${reportId}/${sectionId}/${fileName}`);
      
      await uploadBytes(imageRef, blob);
      const downloadURL = await getDownloadURL(imageRef);
      
      updateSection(sectionId, 'images', downloadURL, true);
    } catch (error) {
      console.error("Error al subir la imagen a Storage:", error);
      alert("Hubo un error al guardar la imagen. Por favor, intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const removeImage = (sectionId, imageIndex) => {
    const section = report.sections.find(s => s.id === sectionId);
    const newImages = [...section.images];
    newImages.splice(imageIndex, 1);
    
    const newSections = report.sections.map(s => 
      s.id === sectionId ? { ...s, images: newImages } : s
    );
    setReport({ ...report, sections: newSections });
  };

  const updateSection = (sectionId, field, value, isArray = false) => {
    if (isViewer) return;
    setReport(prev => {
      const newSections = prev.sections.map(s => {
        if (s.id === sectionId) {
          if (isArray) {
            return { ...s, [field]: [...s[field], value] };
          }
          return { ...s, [field]: value };
        }
        return s;
      });
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const acceptFormalComment = (sectionId) => {
    if (isViewer) return;
    setReport(prevReport => {
      const newSections = prevReport.sections.map(s => {
        if (s.id === sectionId && s.formalComment && s.formalComment !== 'Redactando...') {
          return { ...s, originalComment: s.formalComment, formalComment: '' };
        }
        return s;
      });
      const updated = { ...prevReport, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const enhanceText = async (sectionId) => {
    const section = report.sections.find(s => s.id === sectionId);
    if (!section.originalComment.trim()) return;

    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      alert("No se ha configurado la API Key de Gemini. Ve a Configuración.");
      return;
    }

    try {
      updateSection(sectionId, 'formalComment', 'Redactando...'); // Loading state
      
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

      const glossary = localStorage.getItem('companyGlossary');
      let glossaryContext = '';
      if (glossary && glossary.trim() !== '') {
        glossaryContext = `\n\nIMPORTANTE: El usuario ha dictado el texto original usando un micrófono, por lo que es altamente probable que haya errores tipográficos o palabras transcritas fonéticamente de forma incorrecta. Usa el siguiente GLOSARIO TÉCNICO DE LA EMPRESA para identificar esas palabras mal transcritas y corregirlas en tu redacción final:\n--- GLOSARIO ---\n${glossary}\n----------------\n`;
      }

      const prompt = `Actúa como un experto redactor de informes técnicos. Mejora la redacción del siguiente comentario para que suene muy formal, claro y profesional para un informe técnico. NO inventes ningún dato nuevo, NO agregues conclusiones que no estén en el texto original. Solo mejora la gramática, corrige errores de transcripción de voz y ajusta el tono.

MUY IMPORTANTE: Devuelve ÚNICA Y EXCLUSIVAMENTE el texto mejorado. NO incluyas preámbulos, NO incluyas introducciones como "A continuación se presenta..." ni explicaciones al final. Solo quiero la redacción final.${glossaryContext}

TEXTO ORIGINAL A MEJORAR:
${section.originalComment}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      updateSection(sectionId, 'formalComment', text);
    } catch (error) {
      console.error("Error al generar el texto:", error);
      updateSection(sectionId, 'formalComment', `Error al generar el texto: ${error.message || error}. Verifica tu API Key o conexión.`);
    }
  };

  const handleShare = async () => {
    if (!shareEmail.trim()) return;
    const email = shareEmail.trim().toLowerCase();
    
    const newCollaborators = [...(report.collaborators || [])];
    if (!newCollaborators.includes(email)) newCollaborators.push(email);
    
    const newRoles = { ...(report.roles || {}) };
    newRoles[email] = shareRole;

    const updated = { ...report, collaborators: newCollaborators, roles: newRoles };
    setReport(updated);
    
    try {
      await updateDoc(doc(db, 'reports', id), {
        collaborators: newCollaborators,
        roles: newRoles
      });
      setShareEmail('');
      alert("Usuario invitado correctamente.");
    } catch (e) {
      alert("Error al compartir.");
    }
  };
  
  const handlePublicAccessChange = async (e) => {
    const val = e.target.value;
    setReport(prev => ({...prev, publicAccess: val}));
    await updateDoc(doc(db, 'reports', id), { publicAccess: val });
  };
  
  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Enlace copiado al portapapeles.");
  };

  const saveReport = async () => {
    setSaving(true);
    try {
      const reportData = {
        title: report.title,
        reportDate: report.reportDate || new Date().toISOString().split('T')[0],
        userId: user.uid,
        sections: report.sections, // Ya están comprimidas
        updatedAt: serverTimestamp()
      };

      if (id === 'new') {
        reportData.createdAt = serverTimestamp();
        const docRef = await addDoc(collection(db, 'reports'), reportData);
        navigate(`/report/${docRef.id}`, { replace: true });
      } else {
        await updateDoc(doc(db, 'reports', id), reportData);
      }
      alert('Informe guardado correctamente');
    } catch (error) {
      console.error("Error saving report:", error);
      alert('Error al guardar el informe');
    } finally {
      setSaving(false);
    }
  };

  const generatePDF = async () => {
    setGeneratingPdf(true);
    try {
      // Mostramos el div oculto para el PDF
      const pdfContent = pdfRef.current;
      pdfContent.style.display = 'block';
      
      const canvas = await html2canvas(pdfContent, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      // Manejar múltiples páginas si el contenido es muy largo
      let heightLeft = pdfHeight;
      let position = 0;
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`${report.title.replace(/\s+/g, '_')}_Informe.pdf`);
      
      // Ocultamos el div del PDF
      pdfContent.style.display = 'none';
    } catch (error) {
      console.error("Error generando PDF:", error);
      alert("Error al generar el PDF");
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) return <div className="loading-screen">Cargando editor...</div>;

  return (
    <div className="app-container">
      <nav className="navbar" style={{position: 'sticky', top: 0, zIndex: 100}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
          <Link to="/" className="btn btn-secondary" style={{padding: '0.5rem', borderRadius: '50%'}}>
            <ArrowLeft size={20} />
          </Link>
          <input 
            type="text" 
            value={report.title} 
            onChange={handleTitleChange}
            className="form-control"
            style={{fontWeight: 'bold', fontSize: '1.2rem', border: 'none', background: 'transparent', borderBottom: '2px solid transparent', width: '200px'}}
            placeholder="Título del Informe"
            disabled={isViewer}
          />
          <input 
            type="date"
            value={report.reportDate || ''}
            onChange={handleDateChange}
            className="form-control"
            style={{border: 'none', background: 'transparent', color: 'var(--text-light)', fontSize: '0.9rem'}}
            title="Fecha del Informe"
            disabled={isViewer}
          />
        </div>
        <div className="navbar-actions">
          {isOwner && id !== 'new' && (
            <button onClick={() => setShowShareModal(true)} className="btn btn-secondary" style={{color: 'var(--primary-color)', borderColor: 'var(--primary-color)'}}>
              <Share2 size={18} /> Compartir
            </button>
          )}
          {!isViewer && (
            <button onClick={saveReport} disabled={saving} className="btn btn-secondary">
              <Save size={18} /> {saving ? 'Guardando...' : 'Guardar'}
            </button>
          )}
          <button onClick={generatePDF} disabled={generatingPdf} className="btn btn-primary">
            <FileDown size={18} /> {generatingPdf ? 'Generando...' : 'Crear PDF'}
          </button>
        </div>
      </nav>

      <main className="page-container" style={{maxWidth: '800px', paddingBottom: '100px'}}>
        {report.sections.map((section, index) => (
          <div key={section.id} className="glass-panel" style={{padding: '2rem', marginBottom: '2rem', position: 'relative'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <div style={{display: 'flex', alignItems: 'baseline', gap: '0.5rem'}}>
                <input 
                  type="text" 
                  value={section.title !== undefined ? section.title : 'Apartado'} 
                  onChange={(e) => updateSection(section.id, 'title', e.target.value)}
                  style={{
                    fontSize: '1.17em', fontWeight: 'bold', color: 'var(--primary-color)', 
                    border: 'none', borderBottom: '1px dashed #ccc', background: 'transparent',
                    width: '150px'
                  }}
                  disabled={isViewer}
                />
                <h3 style={{color: 'var(--primary-color)', margin: 0}}>{index + 1}</h3>
              </div>
              {!isViewer && (
                <button onClick={() => removeSection(section.id)} className="btn btn-danger" style={{padding: '0.4rem', borderRadius: '50%'}}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Zona de imágenes */}
            {!isViewer && (
              <div 
                className="image-upload-zone" 
                style={{
                  border: '2px dashed #ccc', 
                  borderRadius: '8px', 
                  padding: '2rem', 
                  textAlign: 'center',
                  marginBottom: '1.5rem',
                  backgroundColor: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer'
                }}
                onPaste={(e) => handleImagePaste(e, section.id)}
              >
                <ImageIcon size={32} color="#ccc" style={{marginBottom: '0.5rem'}} />
                <p style={{margin: '0 0 1rem 0', color: 'var(--text-light)'}}>
                  Haz clic para subir imágenes, tomar una foto o pega (Ctrl+V) imágenes aquí
                </p>
                
                <div style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
                  {/* Botón para subir archivos */}
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    onChange={(e) => handleImageSelect(e, section.id)} 
                    style={{display: 'none'}} 
                    id={`file-upload-${section.id}`}
                  />
                  <label htmlFor={`file-upload-${section.id}`} className="btn btn-secondary" style={{fontSize: '0.85rem'}}>
                    <ImageIcon size={16} /> Seleccionar Archivos
                  </label>

                  {/* Botón para tomar foto (cámara interna) */}
                  <button 
                    onClick={(e) => { e.stopPropagation(); openCamera(section.id); }}
                    className="btn btn-primary" 
                    style={{fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}
                  >
                    <Camera size={16} /> Tomar Foto
                  </button>
                </div>
              </div>
            )}

            {/* Preview de Imágenes */}
            {section.images.length > 0 && (
              <div style={{display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem', marginBottom: '1.5rem'}}>
                {section.images.map((imgUrl, imgIndex) => (
                  <div key={imgIndex} style={{position: 'relative', minWidth: '150px', height: '150px'}}>
                    <div style={{
                      position: 'absolute', top: 5, left: 5, background: 'var(--primary-color)', color: 'white', 
                      width: '24px', height: '24px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '12px', fontWeight: 'bold'
                    }}>
                      {imgIndex + 1}
                    </div>
                    <img 
                      src={imgUrl} 
                      alt={`Foto ${imgIndex + 1}`} 
                      style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd', cursor: 'pointer'}} 
                      onClick={() => setFullScreenImage(imgUrl)}
                    />
                    {!isViewer && (
                      <button 
                        onClick={() => removeImage(section.id, imgIndex)}
                        style={{position: 'absolute', top: 5, right: 5, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center'}}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Comentario Original */}
            <div className="form-group" style={{position: 'relative'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                <label className="form-label" style={{margin: 0}}>Comentario sobre las imágenes:</label>
                {!isViewer && (
                  <button 
                    onClick={() => toggleListening(section.id)}
                    className={`btn ${listeningSection === section.id ? 'btn-danger' : 'btn-secondary'}`}
                    style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center'}}
                    title="Dictar por voz"
                  >
                    {listeningSection === section.id ? <MicOff size={16} /> : <Mic size={16} />}
                    {listeningSection === section.id ? 'Detener' : 'Hablar'}
                  </button>
                )}
              </div>
              <textarea 
                className="form-control" 
                value={listeningSection === section.id && interimTranscript 
                  ? section.originalComment + (section.originalComment && !section.originalComment.endsWith(' ') ? ' ' : '') + interimTranscript 
                  : section.originalComment}
                onChange={(e) => {
                  if (listeningSection !== section.id) {
                    updateSection(section.id, 'originalComment', e.target.value);
                  }
                }}
                readOnly={listeningSection === section.id || isViewer}
                placeholder="Escribe o dicta lo que observas en las fotos..."
                style={{minHeight: '100px'}}
              />
            </div>

            {/* Botón Mejorar Redacción */}
            {!isViewer && (
              <button 
                onClick={() => enhanceText(section.id)} 
                className="btn" 
                style={{background: 'var(--primary-color)', color: 'white', marginBottom: '1.5rem', width: '100%'}}
              >
                <Sparkles size={18} /> Mejorar Redacción con IA
              </button>
            )}

            {/* Comentario Formal */}
            {section.formalComment && (
              <div className="form-group" style={{marginTop: '1rem'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                  <label className="form-label" style={{margin: 0}}>Redacción Formal (Generada por IA):</label>
                  {!isViewer && section.formalComment !== 'Redactando...' && (
                    <button 
                      onClick={() => acceptFormalComment(section.id)} 
                      className="btn btn-secondary" 
                      style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: 'var(--primary-color)', color: 'var(--primary-color)'}}
                    >
                      ✓ Reemplazar texto original
                    </button>
                  )}
                </div>
                <textarea 
                  className="form-control" 
                  value={section.formalComment}
                  onChange={(e) => updateSection(section.id, 'formalComment', e.target.value)}
                  style={{background: '#f8f9fa', borderLeft: '4px solid var(--secondary-color)'}}
                  readOnly={isViewer}
                />
              </div>
            )}
          </div>
        ))}

        {!isViewer && (
          <button onClick={addSection} className="btn btn-secondary" style={{width: '100%', borderStyle: 'dashed', borderWidth: '2px'}}>
            <Plus size={20} /> Añadir otro apartado
          </button>
        )}
      </main>

      {/* --- ESTRUCTURA OCULTA PARA EL PDF --- */}
      <div 
        ref={pdfRef} 
        style={{
          display: 'none', 
          width: '210mm', 
          minHeight: '297mm',
          padding: '20mm', 
          backgroundColor: 'white',
          color: 'black',
          position: 'absolute',
          top: '-9999px',
          left: '-9999px',
          fontFamily: 'sans-serif'
        }}
      >
        {/* Encabezado del PDF */}
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--primary-color)', paddingBottom: '10px', marginBottom: '20px'}}>
          <img src="/Logo.png" alt="Logo" style={{height: '50px'}} />
          <div style={{textAlign: 'right'}}>
            <h1 style={{fontSize: '24px', color: 'var(--primary-color)', margin: '0 0 5px 0'}}>{report.title}</h1>
            <p style={{fontSize: '12px', color: '#666', margin: 0}}>Fecha del informe: {report.reportDate ? new Date(report.reportDate).toLocaleDateString('es-ES') : new Date().toLocaleDateString('es-ES')}</p>
          </div>
        </div>

        {/* Contenido del Informe */}
        {report.sections.map((section, index) => (
          <div key={`pdf-${section.id}`} style={{marginBottom: '30px', pageBreakInside: 'avoid'}}>
            <h2 style={{fontSize: '18px', color: 'var(--secondary-color)', borderBottom: '1px solid #eee', paddingBottom: '5px', marginBottom: '15px'}}>
              {section.title || 'Apartado'} {index + 1}
            </h2>
            
            {/* Grid de Imágenes para el PDF */}
            {section.images.length > 0 && (
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px'}}>
                {section.images.map((imgUrl, imgIndex) => (
                  <div key={`pdf-img-${imgIndex}`} style={{width: '48%', position: 'relative'}}>
                    <div style={{
                      position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,0.7)', color: 'white', 
                      padding: '2px 6px', borderRadius: '4px', fontSize: '10px'
                    }}>
                      Fig. {index + 1}.{imgIndex + 1}
                    </div>
                    <img src={imgUrl} style={{width: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #ccc'}} />
                  </div>
                ))}
              </div>
            )}

            {/* Texto Formal del PDF */}
            <div style={{fontSize: '12px', lineHeight: '1.6', textAlign: 'justify'}}>
              <strong>Observaciones:</strong><br />
              {section.formalComment ? (
                <div style={{whiteSpace: 'pre-wrap', marginTop: '5px'}}>{section.formalComment}</div>
              ) : (
                <div style={{whiteSpace: 'pre-wrap', marginTop: '5px'}}>{section.originalComment}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* --- VISOR DE CÁMARA (WEBRTC) --- */}
      {showShareModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
        }}>
          <div className="glass-panel" style={{width: '100%', maxWidth: '500px', backgroundColor: 'white', padding: '2rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <h2 style={{margin: 0, color: 'var(--primary-color)'}}><Users size={24} style={{verticalAlign: 'middle', marginRight: '0.5rem'}} /> Compartir Informe</h2>
              <button onClick={() => setShowShareModal(false)} style={{background: 'none', border: 'none', cursor: 'pointer'}}>
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
                  <select value={report.publicAccess || 'restricted'} onChange={handlePublicAccessChange} className="form-control" disabled={!isOwner}>
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
                  <span>{report.userId === user.uid ? user.email : report.userId} <strong>(Propietario)</strong></span>
                  <span style={{color: 'var(--text-light)'}}>Propietario</span>
                </div>
                {report.collaborators?.map(email => (
                  <div key={email} style={{display: 'flex', justifyContent: 'space-between', padding: '0.5rem', borderBottom: '1px solid #eee'}}>
                    <span>{email}</span>
                    <span style={{color: 'var(--text-light)'}}>{report.roles?.[email] === 'editor' ? 'Editor' : 'Lector'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '2rem'}}>
              <button onClick={() => setShowShareModal(false)} className="btn btn-primary">Hecho</button>
            </div>
          </div>
        </div>
      )}

      {isCameraOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: '#000', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            style={{width: '100%', height: '80%', objectFit: 'cover'}}
          />
          <canvas ref={canvasRef} style={{display: 'none'}} />
          
          <div style={{
            position: 'absolute', bottom: '5%', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '3rem'
          }}>
            <button 
              onClick={closeCamera}
              style={{
                background: 'rgba(255,255,255,0.2)', color: 'white', 
                border: 'none', borderRadius: '50%', width: '50px', height: '50px',
                display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer'
              }}
            >
              <X size={24} />
            </button>
            <button 
              onClick={takePhoto}
              style={{
                background: 'white', border: '4px solid #ccc', borderRadius: '50%', 
                width: '70px', height: '70px', cursor: 'pointer',
                display: 'flex', justifyContent: 'center', alignItems: 'center'
              }}
            >
              <div style={{background: 'white', borderRadius: '50%', width: '56px', height: '56px', border: '2px solid #ddd'}}></div>
            </button>
            {/* Espaciador para equilibrar el botón X */}
            <div style={{width: '50px'}}></div>
          </div>
        </div>
      )}

      {/* Modal Imagen Pantalla Completa */}
      {fullScreenImage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 9999,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem'
        }} onClick={() => setFullScreenImage(null)}>
          <button 
            onClick={() => setFullScreenImage(null)}
            style={{
              position: 'absolute', top: '20px', right: '20px', 
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', 
              width: '40px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center',
              color: 'white', cursor: 'pointer'
            }}
          >
            <X size={24} />
          </button>
          <img 
            src={fullScreenImage} 
            alt="Vista en grande" 
            style={{maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: '8px'}} 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
