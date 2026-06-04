import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, storage } from '../firebase';
import { doc, getDoc, setDoc, collection, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArrowLeft, Save, FileDown, Plus, Trash2, Image as ImageIcon, Sparkles, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function ReportEditor({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState({
    title: 'Nuevo Informe',
    sections: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const pdfRef = useRef();

  useEffect(() => {
    const fetchReport = async () => {
      if (id === 'new') {
        setReport({
          title: 'Nuevo Informe',
          sections: [{ id: Date.now().toString(), images: [], originalComment: '', formalComment: '' }]
        });
        setLoading(false);
        return;
      }
      
      try {
        const docRef = doc(db, 'reports', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          setReport({ id: docSnap.id, ...docSnap.data() });
        } else {
          alert('Informe no encontrado');
          navigate('/');
        }
      } catch (error) {
        console.error("Error al cargar el informe:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [id, navigate]);

  const handleTitleChange = (e) => {
    setReport({ ...report, title: e.target.value });
  };

  const addSection = () => {
    setReport({
      ...report,
      sections: [...report.sections, { id: Date.now().toString(), images: [], originalComment: '', formalComment: '' }]
    });
  };

  const removeSection = (sectionId) => {
    setReport({
      ...report,
      sections: report.sections.filter(s => s.id !== sectionId)
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
          const MAX_WIDTH = 800; // Reducir tamaño máximo
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
          
          // Comprimir a JPEG con calidad reducida
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const uploadImage = async (file, sectionId) => {
    const compressedDataUrl = await compressImage(file);
    updateSection(sectionId, 'images', compressedDataUrl, true);
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
    const newSections = report.sections.map(s => {
      if (s.id === sectionId) {
        if (isArray) {
          return { ...s, [field]: [...s[field], value] };
        }
        return { ...s, [field]: value };
      }
      return s;
    });
    setReport({ ...report, sections: newSections });
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
      
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `Actúa como un experto redactor de informes técnicos. Mejora la redacción del siguiente comentario para que suene muy formal, claro y profesional para un informe. NO inventes ningún dato nuevo, NO agregues conclusiones que no estén en el texto original. Solo mejora la gramática y el tono del texto proporcionado:\n\n${section.originalComment}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      updateSection(sectionId, 'formalComment', text);
    } catch (error) {
      console.error("Error al generar el texto:", error);
      updateSection(sectionId, 'formalComment', 'Error al generar el texto. Verifica tu API Key.');
    }
  };

  const saveReport = async () => {
    setSaving(true);
    try {
      const reportData = {
        title: report.title,
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
            style={{fontWeight: 'bold', fontSize: '1.2rem', border: 'none', background: 'transparent', borderBottom: '2px solid transparent'}}
            placeholder="Título del Informe"
          />
        </div>
        <div className="navbar-actions">
          <button onClick={saveReport} disabled={saving} className="btn btn-secondary">
            <Save size={18} /> {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button onClick={generatePDF} disabled={generatingPdf} className="btn btn-primary">
            <FileDown size={18} /> {generatingPdf ? 'Generando...' : 'Crear PDF'}
          </button>
        </div>
      </nav>

      <main className="page-container" style={{maxWidth: '800px', paddingBottom: '100px'}}>
        {report.sections.map((section, index) => (
          <div key={section.id} className="glass-panel" style={{padding: '2rem', marginBottom: '2rem', position: 'relative'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <h3 style={{color: 'var(--primary-color)', margin: 0}}>Apartado {index + 1}</h3>
              <button onClick={() => removeSection(section.id)} className="btn btn-danger" style={{padding: '0.4rem', borderRadius: '50%'}}>
                <Trash2 size={16} />
              </button>
            </div>

            {/* Zona de imágenes */}
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
              <p style={{margin: '0 0 0.5rem 0', color: 'var(--text-light)'}}>
                Haz clic para subir imágenes o pega (Ctrl+V) imágenes aquí
              </p>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={(e) => handleImageSelect(e, section.id)} 
                style={{display: 'none'}} 
                id={`file-upload-${section.id}`}
              />
              <label htmlFor={`file-upload-${section.id}`} className="btn btn-secondary" style={{fontSize: '0.85rem'}}>
                Seleccionar Archivos
              </label>
            </div>

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
                    <img src={imgUrl} alt={`Foto ${imgIndex + 1}`} style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd'}} />
                    <button 
                      onClick={() => removeImage(section.id, imgIndex)}
                      style={{position: 'absolute', top: 5, right: 5, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center'}}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Comentario Original */}
            <div className="form-group">
              <label className="form-label">Comentario sobre las imágenes:</label>
              <textarea 
                className="form-control" 
                value={section.originalComment}
                onChange={(e) => updateSection(section.id, 'originalComment', e.target.value)}
                placeholder="Escribe lo que observas en las fotos..."
              />
            </div>

            {/* Botón Mejorar Redacción */}
            <button 
              onClick={() => enhanceText(section.id)} 
              className="btn" 
              style={{background: 'var(--primary-color)', color: 'white', marginBottom: '1.5rem', width: '100%'}}
            >
              <Sparkles size={18} /> Mejorar Redacción con IA
            </button>

            {/* Comentario Formal */}
            {section.formalComment && (
              <div className="form-group">
                <label className="form-label">Redacción Formal (Generada por IA):</label>
                <textarea 
                  className="form-control" 
                  value={section.formalComment}
                  onChange={(e) => updateSection(section.id, 'formalComment', e.target.value)}
                  style={{background: '#f8f9fa', borderLeft: '4px solid var(--secondary-color)'}}
                />
              </div>
            )}
          </div>
        ))}

        <button onClick={addSection} className="btn btn-secondary" style={{width: '100%', borderStyle: 'dashed', borderWidth: '2px'}}>
          <Plus size={20} /> Añadir otro apartado
        </button>
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
            <p style={{fontSize: '12px', color: '#666', margin: 0}}>Fecha: {new Date().toLocaleDateString('es-ES')}</p>
          </div>
        </div>

        {/* Contenido del Informe */}
        {report.sections.map((section, index) => (
          <div key={`pdf-${section.id}`} style={{marginBottom: '30px', pageBreakInside: 'avoid'}}>
            <h2 style={{fontSize: '18px', color: 'var(--secondary-color)', borderBottom: '1px solid #eee', paddingBottom: '5px', marginBottom: '15px'}}>
              Apartado {index + 1}
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

    </div>
  );
}
