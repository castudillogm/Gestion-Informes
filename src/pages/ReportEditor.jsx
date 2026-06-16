import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, serverTimestamp, onSnapshot, query, where, deleteDoc, getDoc } from 'firebase/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArrowLeft, Save, FileDown, Plus, Trash2, Image as ImageIcon, Sparkles, X, Mic, MicOff, Camera, Share2, Users, Link as LinkIcon, FileText, ChevronDown, ChevronUp, Edit } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import SwipeToDelete from '../components/SwipeToDelete';

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
  const [deletedSectionInfo, setDeletedSectionInfo] = useState(null);
  const [uploadingImages, setUploadingImages] = useState({});
  const [reportImages, setReportImages] = useState({});
  const autoSaveTimerRef = useRef(null);

  // Modal and expanded states
  const [expandedSectionId, setExpandedSectionId] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // 'notes', 'photos'
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedSubId, setSelectedSubId] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);

  const isOwner = report.userId === user.uid;
  const role = isOwner ? 'owner' : (report.roles?.[user.email] || 'viewer');
  const isViewer = role === 'viewer';

  const triggerAutoSave = (newReportData) => {
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

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState(null); // { sectionId, subId }
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    return () => {
      if (videoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const openCamera = async (sectionId, subId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Prioriza la cámara trasera
      });
      setCameraTarget({ sectionId, subId });
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
    setCameraTarget(null);
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current || !cameraTarget) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Configurar el canvas al tamaño del video real
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Obtener imagen en base64 (JPEG comprimido)
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    
    // Añadir al subapartado correspondiente
    updateSubSection(cameraTarget.sectionId, cameraTarget.subId, 'images', imageDataUrl, true);
    
    // Cerrar cámara
    closeCamera();
  };

  const toggleListening = (sectionId, subId) => {
    const targetId = `${sectionId}-${subId}`;
    if (listeningSection === targetId) {
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
              const newSubs = (s.subSections || []).map(sub => {
                if (sub.id === subId) {
                  const separator = (sub.originalComment && !sub.originalComment.endsWith(' ')) ? ' ' : '';
                  return { ...sub, originalComment: sub.originalComment + separator + finalTranscript };
                }
                return sub;
              });
              return { ...s, subSections: newSubs };
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
    setListeningSection(targetId);
  };

  useEffect(() => {
    const docRef = doc(db, 'reports', id);
    const unsubscribeReport = onSnapshot(docRef, async (docSnap) => {
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
          const rawData = { id: docSnap.id, ...data };
          let migrated = false;
          
          // MIGRACIÓN A SUBAPARTADOS
          if (rawData.sections) {
            rawData.sections.forEach(s => {
              if (!s.subSections) {
                s.subSections = [{
                  id: s.id + '-sub0',
                  subtitle: 'General',
                  images: s.images || [],
                  originalComment: s.originalComment || '',
                  formalComment: s.formalComment || '',
                  createdBy: s.createdBy || { name: 'Migrado' }
                }];
                delete s.images;
                delete s.originalComment;
                delete s.formalComment;
                migrated = true;
              }
            });
          }
          
          setReport(rawData);
          if (migrated && (isOwner || data.publicAccess === 'editor')) {
            triggerAutoSave(rawData);
          }
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

    const imagesQuery = query(collection(db, 'reportImages'), where('reportId', '==', id));
    const unsubscribeImages = onSnapshot(imagesQuery, (snapshot) => {
      const imagesMap = {};
      snapshot.docs.forEach(doc => {
        imagesMap[doc.id] = doc.data().dataUrl;
      });
      setReportImages(imagesMap);
    });

    return () => {
      unsubscribeReport();
      unsubscribeImages();
    };
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
      id: Date.now().toString(), title: 'Nuevo Apartado',
      subSections: [{
        id: Date.now().toString() + '-sub', subtitle: 'General', images: [], originalComment: '', formalComment: '',
        createdBy: { name: user.displayName || 'Usuario', photoURL: user.photoURL || '', email: user.email }
      }]
    };
    setReport(prev => {
      const updated = { ...prev, sections: [...prev.sections, newSection] };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const removeSection = (sectionId) => {
    if (isViewer) return;
    
    const index = report.sections.findIndex(s => s.id === sectionId);
    const sectionToRestore = report.sections[index];
    
    if (deletedSectionInfo?.timerId) clearTimeout(deletedSectionInfo.timerId);
    const timerId = setTimeout(() => {
      setDeletedSectionInfo(null);
    }, 120000); // 2 minutos
    
    setDeletedSectionInfo({ section: sectionToRestore, index, timerId });

    setReport(prev => {
      const updated = { ...prev, sections: prev.sections.filter(s => s.id !== sectionId) };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const undoDeleteSection = () => {
    if (!deletedSectionInfo || isViewer) return;
    
    setReport(prev => {
      const newSections = [...prev.sections];
      newSections.splice(deletedSectionInfo.index, 0, deletedSectionInfo.section);
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
    
    clearTimeout(deletedSectionInfo.timerId);
    setDeletedSectionInfo(null);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (deletedSectionInfo && !isViewer) {
          if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            undoDeleteSection();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedSectionInfo, isViewer]);

  const addSubSection = (sectionId) => {
    if (isViewer) return;
    const newSub = {
      id: Date.now().toString(), subtitle: 'Nuevo Subapartado', images: [], originalComment: '', formalComment: '',
      createdBy: { name: user.displayName || 'Usuario', photoURL: user.photoURL || '', email: user.email }
    };
    setReport(prev => {
      const newSections = prev.sections.map(s => {
        if (s.id === sectionId) return { ...s, subSections: [...(s.subSections || []), newSub] };
        return s;
      });
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const removeSubSection = (sectionId, subId) => {
    if (isViewer) return;
    if (!window.confirm('¿Seguro que deseas eliminar este subapartado?')) return;
    setReport(prev => {
      const newSections = prev.sections.map(s => {
        if (s.id === sectionId) {
          return { ...s, subSections: (s.subSections || []).filter(sub => sub.id !== subId) };
        }
        return s;
      });
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const handleDragStart = (e, sectionId, subId) => {
    if (isViewer) return;
    setDraggedItem({ sectionId, subId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', subId); // required for Firefox
  };

  const handleDragOver = (e) => {
    if (isViewer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetSectionId, targetSubId) => {
    if (isViewer) return;
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    const { sectionId: sourceSectionId, subId: sourceSubId } = draggedItem;

    if (sourceSectionId === targetSectionId && sourceSubId === targetSubId) {
      setDraggedItem(null);
      return;
    }

    setReport(prev => {
      let sourceSub = null;
      prev.sections.forEach(s => {
        if (s.id === sourceSectionId) {
          sourceSub = (s.subSections || []).find(sub => sub.id === sourceSubId);
        }
      });

      if (!sourceSub) return prev;

      let newSections = prev.sections.map(s => {
        if (s.id === sourceSectionId) {
          return { ...s, subSections: (s.subSections || []).filter(sub => sub.id !== sourceSubId) };
        }
        return s;
      });

      const targetSectionIndex = newSections.findIndex(s => s.id === targetSectionId);
      if (targetSectionIndex !== -1) {
        let newSubs = [...(newSections[targetSectionIndex].subSections || [])];
        if (targetSubId) {
          const targetIndex = newSubs.findIndex(sub => sub.id === targetSubId);
          if (targetIndex !== -1) {
            newSubs.splice(targetIndex, 0, sourceSub);
          } else {
            newSubs.push(sourceSub);
          }
        } else {
          newSubs.push(sourceSub);
        }
        newSections[targetSectionIndex] = { ...newSections[targetSectionIndex], subSections: newSubs };
      }

      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });

    setDraggedItem(null);
  };

  const handleImagePaste = (e, sectionId, subId) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        uploadImage(blob, sectionId, subId);
      }
    }
  };

  const handleImageSelect = (e, sectionId, subId) => {
    const files = e.target.files;
    if (!files) return;
    
    Array.from(files).forEach(file => {
      uploadImage(file, sectionId, subId);
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

  const uploadImage = async (file, sectionId, subId) => {
    let compressedDataUrl = null;
    try {
      setSaving(true);
      compressedDataUrl = await compressImage(file);
      
      const targetId = `${sectionId}-${subId}`;
      setUploadingImages(prev => ({
        ...prev,
        [targetId]: [...(prev[targetId] || []), compressedDataUrl]
      }));

      const docRef = await addDoc(collection(db, 'reportImages'), {
        reportId: id,
        sectionId: sectionId,
        subId: subId,
        dataUrl: compressedDataUrl,
        createdAt: serverTimestamp()
      });
      
      updateSubSection(sectionId, subId, 'images', docRef.id, true);
    } catch (error) {
      console.error("Error guardando la imagen:", error);
      alert("Hubo un error al guardar la imagen. Por favor, intenta de nuevo.");
    } finally {
      const targetId = `${sectionId}-${subId}`;
      if (compressedDataUrl) {
        setUploadingImages(prev => ({
          ...prev,
          [targetId]: (prev[targetId] || []).filter(url => url !== compressedDataUrl)
        }));
      }
      setSaving(false);
    }
  };

  const removeImage = async (sectionId, subId, imageIndex) => {
    const section = report.sections.find(s => s.id === sectionId);
    const sub = section.subSections.find(s => s.id === subId);
    const imageId = sub.images[imageIndex];
    
    try {
      await deleteDoc(doc(db, 'reportImages', imageId));
    } catch (error) {
      console.error("Error al eliminar la imagen de Firestore:", error);
    }

    const newImages = [...sub.images];
    newImages.splice(imageIndex, 1);
    
    updateSubSection(sectionId, subId, 'images', newImages, false);
  };

  const updateSubSection = (sectionId, subId, field, value, isArray = false) => {
    if (isViewer) return;
    setReport(prev => {
      const newSections = prev.sections.map(s => {
        if (s.id === sectionId) {
          const newSubs = (s.subSections || []).map(sub => {
            if (sub.id === subId) {
              if (isArray) return { ...sub, [field]: [...sub[field], value] };
              return { ...sub, [field]: value };
            }
            return sub;
          });
          return { ...s, subSections: newSubs };
        }
        return s;
      });
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const updateSection = (sectionId, field, value) => {
    if (isViewer) return;
    setReport(prev => {
      const newSections = prev.sections.map(s => {
        if (s.id === sectionId) {
          return { ...s, [field]: value };
        }
        return s;
      });
      const updated = { ...prev, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const handleDocumentUpload = async (e, sectionId, subId) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      let isPdf = false;
      let extractedText = null;
      
      if (file.type === 'application/pdf') {
        isPdf = true;
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result.split(',')[1]);
          reader.readAsDataURL(file);
        });
        updateSubSection(sectionId, subId, 'tempDocument', {
          inlineData: { data: base64, mimeType: 'application/pdf' },
          name: file.name
        });
        alert(`PDF "${file.name}" cargado en memoria listo para que la IA lo lea.`);
        return;
      } else if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else if (file.name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        extractedText = XLSX.utils.sheet_to_csv(firstSheet);
      } else {
        alert("Formato no soportado. Sube PDF, DOCX o XLSX.");
        return;
      }
      
      if (!isPdf && extractedText !== null) {
        updateSubSection(sectionId, subId, 'tempDocument', {
          textData: extractedText,
          name: file.name
        });
      }
      
      alert(`Documento "${file.name}" adjuntado en memoria para la IA.`);
      
    } catch (err) {
      console.error(err);
      alert("Error leyendo el documento. Asegúrate de que no esté corrupto.");
    }
  };

  const acceptFormalComment = (sectionId, subId) => {
    if (isViewer) return;
    setReport(prevReport => {
      const newSections = prevReport.sections.map(s => {
        if (s.id === sectionId) {
          const newSubs = s.subSections.map(sub => {
            if (sub.id === subId && sub.formalComment && sub.formalComment !== 'Redactando...') {
              return { ...sub, originalComment: sub.formalComment, formalComment: '', tempDocument: null };
            }
            return sub;
          });
          return { ...s, subSections: newSubs };
        }
        return s;
      });
      const updated = { ...prevReport, sections: newSections };
      triggerAutoSave(updated);
      return updated;
    });
  };

  const enhanceText = async (sectionId, subId) => {
    const section = report.sections.find(s => s.id === sectionId);
    const sub = section.subSections.find(s => s.id === subId);
    if (!sub.originalComment?.trim() && !sub.tempDocument) {
      alert("No hay texto original o documento adjunto para mejorar.");
      return;
    }

    let apiKey = localStorage.getItem('geminiApiKey');
    let glossary = localStorage.getItem('companyGlossary');

    try {
      const configSnap = await getDoc(doc(db, 'globalSettings', 'config'));
      if (configSnap.exists()) {
        if (configSnap.data().geminiApiKey) apiKey = configSnap.data().geminiApiKey;
        if (configSnap.data().companyGlossary) glossary = configSnap.data().companyGlossary;
      }
    } catch(e) { console.error("No se pudo cargar la config global", e); }

    if (!apiKey) {
      alert("No se ha configurado la API Key de Gemini. Ve a Configuración.");
      return;
    }

    try {
      updateSubSection(sectionId, subId, 'formalComment', 'Redactando...'); // Loading state
      
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

      let glossaryContext = '';
      if (glossary && glossary.trim() !== '') {
        glossaryContext = `\n\nIMPORTANTE: El usuario ha dictado el texto original usando un micrófono, por lo que es altamente probable que haya errores tipográficos o palabras transcritas fonéticamente de forma incorrecta. Usa el siguiente GLOSARIO TÉCNICO DE LA EMPRESA para identificar esas palabras mal transcritas y corregirlas en tu redacción final:\n--- GLOSARIO ---\n${glossary}\n----------------\n`;
      }

      const promptText = `Actúa como un experto redactor de informes técnicos. Mejora la redacción del siguiente comentario (y analiza los documentos adjuntos si los hay) para que suene muy formal, claro y profesional para un informe técnico. Resume hallazgos clave de los documentos para complementar el texto. NO inventes ningún dato nuevo. Solo mejora la gramática, corrige errores de transcripción de voz y ajusta el tono.

MUY IMPORTANTE: Devuelve ÚNICA Y EXCLUSIVAMENTE el texto mejorado. NO incluyas preámbulos, NO incluyas introducciones como "A continuación se presenta..." ni explicaciones al final. Solo quiero la redacción final.${glossaryContext}

TEXTO ORIGINAL A MEJORAR:
${sub.originalComment || '(Solo hay documento adjunto)'}`;

      const promptParams = [promptText];
      if (sub.tempDocument) {
        if (sub.tempDocument.inlineData) {
          promptParams.push(sub.tempDocument.inlineData);
        } else if (sub.tempDocument.textData) {
          promptParams.push(`\n\nCONTENIDO DEL DOCUMENTO ADJUNTO "${sub.tempDocument.name}":\n${sub.tempDocument.textData}`);
        }
      }

      const result = await model.generateContent(promptParams);
      const response = await result.response;
      const text = response.text();

      updateSubSection(sectionId, subId, 'formalComment', text);
    } catch (error) {
      console.error("Error al generar el texto:", error);
      updateSubSection(sectionId, subId, 'formalComment', `Error al generar el texto: ${error.message || error}. Verifica tu API Key o conexión.`);
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
    } catch (error) {
      console.error(error);
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
        sections: report.sections,
        updatedAt: serverTimestamp()
      };

      await updateDoc(doc(db, 'reports', id), reportData);
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

      <main className="page-container" style={{maxWidth: '1000px', paddingBottom: '100px', margin: '0 auto'}}>
        {report.sections.map((section, index) => {
          const isExpanded = expandedSectionId === section.id;
          const sectionDate = section.createdAt || report.reportDate || new Date().toLocaleDateString();

          return (
          <SwipeToDelete
            key={section.id}
            disabled={isViewer}
            itemName={`el apartado "${section.title}"`}
            onDelete={() => removeSection(section.id)}
            style={{marginBottom: '1rem'}}
          >
          <div 
            className="glass-panel" 
            style={{overflow: 'hidden'}}
            onDragEnter={() => {
              if (draggedItem && !isViewer && expandedSectionId !== section.id) {
                setExpandedSectionId(section.id);
              }
            }}
          >
            {/* Fila del Apartado */}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', backgroundColor: isExpanded ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)', borderBottom: isExpanded ? '1px solid #ddd' : 'none'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flex: 1}}>
                <div style={{width: '30px', height: '30px', borderRadius: '50%', backgroundColor: 'var(--primary-color)', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold'}}>
                  {index + 1}
                </div>
                <input 
                  type="text" 
                  value={section.title ?? ''} 
                  onChange={(e) => updateSection(section.id, 'title', e.target.value)}
                  style={{
                    fontSize: '1.1em', fontWeight: 'bold', color: 'var(--text-color)', 
                    border: 'none', background: 'transparent', flex: 1, minWidth: '200px'
                  }}
                  placeholder="Apartado"
                  disabled={isViewer}
                />
                <span style={{fontSize: '0.85em', color: 'var(--text-light)', marginRight: '1rem'}}>{sectionDate}</span>
              </div>
              
              <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                <button onClick={() => setExpandedSectionId(isExpanded ? null : section.id)} className="btn btn-secondary" style={{padding: '0.4rem', border: 'none', background: 'transparent'}}>
                  {isExpanded ? <ChevronUp size={20} color="var(--primary-color)" /> : <ChevronDown size={20} color="var(--primary-color)" />}
                </button>
                {!isViewer && (
                  <button onClick={() => removeSection(section.id)} className="btn btn-danger" style={{padding: '0.4rem', borderRadius: '50%'}}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Tabla de Subapartados */}
            {isExpanded && (
              <div style={{padding: '0', backgroundColor: '#fdfdfd'}}>
                {/* Cabecera de la tabla */}
                <div style={{display: 'flex', backgroundColor: '#f1f3f5', padding: '0.8rem 1.5rem', borderBottom: '1px solid #ddd', fontSize: '0.85rem', fontWeight: 'bold', color: '#495057'}}>
                  <div style={{flex: 3}}>Nombre del Subapartado</div>
                  <div style={{flex: 1, textAlign: 'center'}}>Notas y Observaciones</div>
                  <div style={{flex: 1, textAlign: 'center'}}>Fotos / Evidencias</div>
                  <div style={{width: '40px'}}></div>
                </div>

                {/* Filas de la tabla */}
                {(section.subSections || []).map((sub, subIndex) => {
                  const targetId = `${section.id}-${sub.id}`;
                  const hasNotes = !!(sub.originalComment || sub.formalComment || sub.tempDocument);
                  const imageCount = sub.images ? sub.images.length : 0;

                  return (
                  <SwipeToDelete
                    key={sub.id}
                    disabled={isViewer}
                    itemName="este subapartado"
                    onDelete={() => removeSubSection(section.id, sub.id)}
                  >
                  <div 
                    draggable={!isViewer}
                    onDragStart={(e) => handleDragStart(e, section.id, sub.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, section.id, sub.id)}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '0.8rem 1.5rem', 
                      borderBottom: '1px solid #eee', transition: 'background 0.2s',
                      cursor: isViewer ? 'default' : 'grab',
                      opacity: draggedItem?.subId === sub.id ? 0.5 : 1
                    }} 
                    className="table-row-hover"
                  >
                    {/* Columna Nombre */}
                    <div style={{flex: 3, display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <span style={{fontSize: '0.8rem', color: '#888', fontWeight: 'bold'}}>{index + 1}.{subIndex + 1}</span>
                      <input 
                        type="text" 
                        value={sub.subtitle ?? ''} 
                        onChange={(e) => updateSubSection(section.id, sub.id, 'subtitle', e.target.value)}
                        style={{
                          fontSize: '0.95em', color: 'var(--text-color)', 
                          border: 'none', background: 'transparent', width: '100%'
                        }}
                        placeholder="Subapartado"
                        disabled={isViewer}
                      />
                    </div>

                    {/* Columna Notas */}
                    <div style={{flex: 1, display: 'flex', justifyContent: 'center'}}>
                      <button 
                        onClick={() => {
                          setSelectedSectionId(section.id);
                          setSelectedSubId(sub.id);
                          setActiveModal('notes');
                        }}
                        style={{
                          background: hasNotes ? 'rgba(0, 123, 255, 0.1)' : 'transparent',
                          border: `1px solid ${hasNotes ? 'var(--primary-color)' : '#ddd'}`,
                          borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          color: hasNotes ? 'var(--primary-color)' : '#666'
                        }}
                      >
                        <Edit size={16} /> {hasNotes ? 'Editar Notas' : 'Añadir Notas'}
                      </button>
                    </div>

                    {/* Columna Fotos */}
                    <div style={{flex: 1, display: 'flex', justifyContent: 'center'}}>
                      <button 
                        onClick={() => {
                          setSelectedSectionId(section.id);
                          setSelectedSubId(sub.id);
                          setActiveModal('photos');
                        }}
                        style={{
                          background: imageCount > 0 ? 'rgba(40, 167, 69, 0.1)' : 'transparent',
                          border: `1px solid ${imageCount > 0 ? '#28a745' : '#ddd'}`,
                          borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          color: imageCount > 0 ? '#28a745' : '#666'
                        }}
                      >
                        <Camera size={16} /> 
                        {imageCount > 0 ? `${imageCount} Foto${imageCount > 1 ? 's' : ''}` : 'Añadir Fotos'}
                      </button>
                    </div>

                    {/* Columna Borrar */}
                    <div style={{width: '40px', display: 'flex', justifyContent: 'flex-end'}}>
                      {!isViewer && (
                        <button onClick={() => removeSubSection(section.id, sub.id)} className="btn btn-danger" style={{padding: '0.3rem', borderRadius: '50%', background: 'transparent', color: '#ff4d4f', border: 'none'}}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  </SwipeToDelete>
                )})}
                
                {/* Fila para añadir subapartado */}
                {!isViewer && (
                  <div 
                    style={{padding: '0.5rem 1.5rem', backgroundColor: '#fdfdfd'}}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, section.id, null)}
                  >
                    <button onClick={() => addSubSection(section.id)} className="btn btn-secondary" style={{width: '100%', borderStyle: 'dashed', borderWidth: '1px', fontSize: '0.85rem', padding: '0.4rem', color: '#666'}}>
                      <Plus size={16} /> Añadir fila
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          </SwipeToDelete>
        )})}

        {!isViewer && (
          <button onClick={addSection} className="btn btn-secondary" style={{width: '100%', borderStyle: 'dashed', borderWidth: '2px', padding: '1rem', marginTop: '1rem'}}>
            <Plus size={20} /> Añadir nuevo apartado
          </button>
        )}
      </main>

      
      {/* --- MODALES (VENTANAS EMERGENTES) --- */}
      {/* Modal de Notas */}
      {activeModal === 'notes' && selectedSectionId && selectedSubId && (() => {
        const targetId = `${selectedSectionId}-${selectedSubId}`;
        const section = report.sections.find(s => s.id === selectedSectionId);
        const sub = section?.subSections.find(s => s.id === selectedSubId);
        if (!sub) return null;

        return (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
        }}>
          <div className="glass-panel" style={{width: '100%', maxWidth: '700px', backgroundColor: 'white', padding: '2rem', maxHeight: '90vh', overflowY: 'auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <h2 style={{margin: 0, color: 'var(--primary-color)'}}><Edit size={24} style={{verticalAlign: 'middle', marginRight: '0.5rem'}} /> Notas y Observaciones</h2>
              <button onClick={() => setActiveModal(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={24} color="#666" /></button>
            </div>
            
            <div className="form-group" style={{position: 'relative'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                <label className="form-label" style={{margin: 0}}>Notas Originales:</label>
                {!isViewer && (
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <input 
                      type="file" accept=".pdf,.doc,.docx,.xlsx" 
                      onChange={(e) => handleDocumentUpload(e, selectedSectionId, selectedSubId)} 
                      style={{display: 'none'}} id={`doc-upload-${targetId}`}
                    />
                    <label htmlFor={`doc-upload-${targetId}`} className="btn btn-secondary" style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer'}}>
                      <FileText size={16} /> Adjuntar Documento
                    </label>
                    <button 
                      onClick={() => toggleListening(selectedSectionId, selectedSubId)}
                      className={`btn ${listeningSection === targetId ? 'btn-danger' : 'btn-secondary'}`}
                      style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center'}}
                      title="Dictar por voz"
                    >
                      {listeningSection === targetId ? <MicOff size={16} /> : <Mic size={16} />}
                      {listeningSection === targetId ? 'Detener' : 'Dictar'}
                    </button>
                  </div>
                )}
              </div>
              <textarea 
                className="form-control" 
                value={listeningSection === targetId && interimTranscript 
                  ? sub.originalComment + (sub.originalComment && !sub.originalComment.endsWith(' ') ? ' ' : '') + interimTranscript 
                  : sub.originalComment}
                onChange={(e) => {
                  if (listeningSection !== targetId) {
                    updateSubSection(selectedSectionId, selectedSubId, 'originalComment', e.target.value);
                  }
                }}
                readOnly={listeningSection === targetId || isViewer}
                placeholder="Escribe o dicta tus notas aquí..."
                style={{minHeight: '150px'}}
              />
              {sub.tempDocument && (
                <div style={{marginTop: '0.5rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.8rem', color: '#0277bd', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  <FileText size={14} /> Documento temporal en memoria: {sub.tempDocument.name}
                </div>
              )}
            </div>

            {!isViewer && (
              <button 
                onClick={() => enhanceText(selectedSectionId, selectedSubId)} 
                className="btn" 
                style={{background: 'var(--primary-color)', color: 'white', margin: '1rem 0', width: '100%', padding: '0.8rem', fontSize: '1rem'}}
              >
                <Sparkles size={18} /> Mejorar Redacción con IA
              </button>
            )}

            <div className="form-group">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                <label className="form-label" style={{margin: 0}}>Comentario Formal (Para PDF):</label>
                {!isViewer && sub.formalComment !== 'Redactando...' && sub.formalComment && (
                  <button 
                    onClick={() => acceptFormalComment(selectedSectionId, selectedSubId)} 
                    className="btn btn-secondary" 
                    style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: 'var(--primary-color)', color: 'var(--primary-color)'}}
                  >
                    ✓ Reemplazar notas originales
                  </button>
                )}
              </div>
              <textarea 
                className="form-control" 
                value={sub.formalComment}
                onChange={(e) => updateSubSection(selectedSectionId, selectedSubId, 'formalComment', e.target.value)}
                style={{background: '#f8f9fa', borderLeft: '4px solid var(--secondary-color)', minHeight: '150px'}}
                readOnly={isViewer}
                placeholder="Aquí aparecerá el texto mejorado..."
              />
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem'}}>
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">Cerrar</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal de Fotos */}
      {activeModal === 'photos' && selectedSectionId && selectedSubId && (() => {
        const targetId = `${selectedSectionId}-${selectedSubId}`;
        const section = report.sections.find(s => s.id === selectedSectionId);
        const sub = section?.subSections.find(s => s.id === selectedSubId);
        if (!sub) return null;

        return (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem'
        }}>
          <div className="glass-panel" style={{width: '100%', maxWidth: '800px', backgroundColor: 'white', padding: '2rem', maxHeight: '90vh', overflowY: 'auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
              <h2 style={{margin: 0, color: 'var(--primary-color)'}}><ImageIcon size={24} style={{verticalAlign: 'middle', marginRight: '0.5rem'}} /> Fotos y Evidencias</h2>
              <button onClick={() => setActiveModal(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={24} color="#666" /></button>
            </div>

            {!isViewer && (
              <div 
                className="image-upload-zone" 
                style={{
                  border: '2px dashed #ccc', borderRadius: '8px', padding: '2rem', 
                  textAlign: 'center', marginBottom: '1.5rem', backgroundColor: '#f8f9fa', cursor: 'pointer'
                }}
                onPaste={(e) => handleImagePaste(e, selectedSectionId, selectedSubId)}
              >
                <ImageIcon size={36} color="#ccc" style={{marginBottom: '1rem'}} />
                <p style={{margin: '0 0 1rem 0', color: 'var(--text-light)', fontSize: '1rem'}}>
                  Haz clic para subir imágenes, tomar una foto o pega (Ctrl+V) imágenes aquí
                </p>
                
                <div style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
                  <input 
                    type="file" multiple accept="image/*" 
                    onChange={(e) => handleImageSelect(e, selectedSectionId, selectedSubId)} 
                    style={{display: 'none'}} id={`file-upload-modal-${targetId}`}
                  />
                  <label htmlFor={`file-upload-modal-${targetId}`} className="btn btn-secondary">
                    <ImageIcon size={18} /> Seleccionar Fotos
                  </label>

                  <button 
                    onClick={(e) => { e.stopPropagation(); openCamera(selectedSectionId, selectedSubId); setActiveModal(null); }}
                    className="btn btn-primary" style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}
                  >
                    <Camera size={18} /> Tomar Foto
                  </button>
                </div>
              </div>
            )}

            {/* Preview de Imágenes en el Modal */}
            <div style={{display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem'}}>
              {(sub.images || []).map((imgId, imgIndex) => {
                const imgUrl = reportImages[imgId] || 'https://via.placeholder.com/150?text=Cargando...';
                return (
                <div key={imgIndex} style={{position: 'relative', width: '150px', height: '150px'}}>
                  <div style={{position: 'absolute', top: 5, left: 5, background: 'var(--primary-color)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '12px', fontWeight: 'bold'}}>
                    {imgIndex + 1}
                  </div>
                  <img 
                    src={imgUrl} alt={`Foto ${imgIndex + 1}`} 
                    style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd', cursor: 'pointer'}} 
                    onClick={() => setFullScreenImage(imgUrl)}
                  />
                  {!isViewer && (
                    <button 
                      onClick={() => removeImage(selectedSectionId, selectedSubId, imgIndex)}
                      style={{position: 'absolute', top: 5, right: 5, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center'}}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                );
              })}
              {/* Imágenes Subiendo */}
              {(uploadingImages[targetId] || []).map((imgUrl, imgIndex) => (
                <div key={`uploading-${imgIndex}`} style={{position: 'relative', width: '150px', height: '150px', opacity: 0.6}}>
                  <img src={imgUrl} alt="Subiendo" style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd'}} />
                  <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', color: 'white', padding: '5px 10px', borderRadius: '15px', fontSize: '0.8rem', fontWeight: 'bold'}}>
                    Subiendo...
                  </div>
                </div>
              ))}
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '2rem'}}>
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">Cerrar</button>
            </div>
          </div>
        </div>
        );
      })()}

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
            <h2 style={{fontSize: '20px', color: 'var(--primary-color)', borderBottom: '2px solid #eee', paddingBottom: '5px', marginBottom: '15px'}}>
              {index + 1}. {section.title || 'Apartado'}
            </h2>
            
            {(section.subSections || []).map((sub, subIndex) => (
              <div key={`pdf-sub-${sub.id}`} style={{marginBottom: '20px', marginLeft: '10px', pageBreakInside: 'avoid'}}>
                <h3 style={{fontSize: '16px', color: 'var(--secondary-color)', marginBottom: '10px'}}>
                  {index + 1}.{subIndex + 1} {sub.subtitle}
                </h3>
                
                {/* Grid de Imágenes para el PDF */}
                {sub.images && sub.images.length > 0 && (
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px'}}>
                    {sub.images.map((imgId, imgIndex) => {
                      const imgUrl = reportImages[imgId];
                      if (!imgUrl) return null;
                      return (
                      <div key={`pdf-img-${imgIndex}`} style={{width: '48%', position: 'relative'}}>
                        <div style={{
                          position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,0.7)', color: 'white', 
                          padding: '2px 6px', borderRadius: '4px', fontSize: '10px'
                        }}>
                          Fig. {index + 1}.{subIndex + 1}.{imgIndex + 1}
                        </div>
                        <img src={imgUrl} style={{width: '100%', height: 'auto', borderRadius: '4px', border: '1px solid #ccc'}} />
                      </div>
                    )})}
                  </div>
                )}

                {/* Texto Formal del PDF */}
                <div style={{fontSize: '12px', lineHeight: '1.6', textAlign: 'justify'}}>
                  <strong>Observaciones:</strong><br />
                  {sub.formalComment ? (
                    <div style={{whiteSpace: 'pre-wrap', marginTop: '5px'}}>{sub.formalComment}</div>
                  ) : (
                    <div style={{whiteSpace: 'pre-wrap', marginTop: '5px'}}>{sub.originalComment}</div>
                  )}
                </div>
              </div>
            ))}
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

      {/* Toast Deshacer Eliminar */}
      {deletedSectionInfo && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '20px', 
          backgroundColor: '#323232', color: 'white', padding: '12px 20px', 
          borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1000
        }}>
          <span>Apartado eliminado</span>
          <button onClick={undoDeleteSection} style={{
            background: 'transparent', border: 'none', color: '#4CAF50', 
            fontWeight: 'bold', cursor: 'pointer', padding: 0
          }}>
            Deshacer (Ctrl+Z)
          </button>
          <button onClick={() => {
            clearTimeout(deletedSectionInfo.timerId);
            setDeletedSectionInfo(null);
          }} style={{
            background: 'transparent', border: 'none', color: '#999', 
            cursor: 'pointer', padding: '0 5px'
          }}>
            <X size={16} />
          </button>
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
