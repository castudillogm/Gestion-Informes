# Resumen del Proyecto: Gestor de Informes (Web & Móvil)

## Estado Actual del Proyecto
El proyecto ha sido exitosamente transformado de una aplicación web estándar (React + Vite) a una aplicación web progresiva y empaquetable como nativa utilizando **Capacitor**.

## "Skills" y Funcionalidades Implementadas
Se han mantenido y mejorado absolutamente todas las capacidades de la plataforma:

1. **Gestión de Informes Completos**: Creación, edición, guardado y eliminación.
2. **Estructura Dinámica**: Manejo de apartados y subapartados ilimitados.
3. **Reconocimiento de Voz (Speech-to-Text)**: Para el llenado rápido de observaciones.
4. **Captura y Gestión de Imágenes**: Toma de fotos en tiempo real con la cámara o subida desde galería.
5. **Compresión Automática de Imágenes**: Optimización de peso antes de subir a Firebase.
6. **Integración con IA (Gemini)**: Generación automática de resúmenes formales a partir de notas sueltas.
7. **Procesamiento de Archivos Office**: Lectura de metadatos de Word (`.docx`) y Excel (`.xlsx`).
8. **Exportación a PDF**: Generación de reportes limpios con `jsPDF` y `html2canvas`.
9. **Colaboración en Tiempo Real**: Roles de Propietario, Editor y Lector mediante Firebase Firestore.
10. **Drag & Drop (Arrastrar y Soltar)**: Movimiento fluido de subapartados entre distintos apartados para reordenar la información rápidamente.
11. **Auto-despliegue de Apartados**: Al arrastrar un elemento sobre un apartado cerrado, este se abre automáticamente.
12. **NUEVO: Swipe-to-Delete (Deslizar para eliminar)**: Funcionalidad móvil nativa para borrar informes, apartados y subapartados deslizando el dedo hacia la izquierda, con pop-up de confirmación seguro.

## Próximos Pasos (Pendientes para la siguiente sesión)
- Instalación del entorno de Android Studio y Java 17 en la máquina local.
- Compilación final del archivo `.apk`.
- Pruebas físicas en dispositivo Android.
