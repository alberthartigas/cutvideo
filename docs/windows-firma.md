# Windows: el aviso de SmartScreen y los antivirus

CutVideo se compila en GitHub Actions a partir del código de este repositorio,
pero el `.exe` **no va firmado**, y en Windows eso se nota: SmartScreen avisa de
un «editor desconocido» y Defender le pasa el antivirus antes de dejarlo correr.
No es que la app haga nada raro; es que Windows desconfía por defecto de
cualquier programa sin certificado y sin historial de descargas.

## Instalarlo mientras tanto

1. **Más información → Ejecutar de todas formas** en el aviso azul.
2. Si Defender lo pone en cuarentena: Seguridad de Windows → Protección contra
   virus → Historial de protección → *Permitir en el dispositivo*.

## Quitar la detección (gratis, y ayuda a todo el mundo)

Si un antivirus lo marca como amenaza (no solo «editor desconocido»), es un
falso positivo y conviene reportarlo: Microsoft suele quitarlo en uno o tres
días y deja de salir a todos los que lo descarguen.

1. Ve a <https://www.microsoft.com/en-us/wdsi/filesubmission>.
2. Elige *Software developer* y sube el instalador de la release.
3. Marca **«Incorrectly detected as malware»** y pon la URL de la release.

Guarda el nombre exacto de la detección (por ejemplo
`Trojan:Script/Wacatac.B!ml`): es lo que hay que poner en el informe, y también
lo que dice si el problema es de verdad la app o el ffmpeg que lleva dentro.

## La solución de verdad: firmar el ejecutable

Un certificado de firma de código hace que Windows enseñe tu nombre como editor
y baja muchísimo las alarmas de los antivirus. Desde 2023 la clave privada tiene
que vivir en un dispositivo criptográfico o en un HSM, así que ya no hay archivos
`.pfx` sueltos. Opciones, de más barata a más cara:

| Opción | Coste | Qué hace falta | SmartScreen |
| --- | --- | --- | --- |
| **Azure Artifact Signing** (antes Trusted Signing) | **9,99 $/mes** (5.000 firmas) | Cuenta de Azure y validación de identidad; ya admite desarrolladores individuales | Reconocido desde el primer día |
| **Certum Open Source Code Signing** | ~100 €/año | Verificación de identidad + lector y tarjeta criptográfica (se envían por correo) | Reputación que se va ganando |
| **Certificado EV** (SSL.com, DigiCert…) | 300–600 $/año | Empresa registrada + token físico | Confianza inmediata |

Para un proyecto MIT de una persona, **Azure Artifact Signing es la que sale a
cuenta**: se integra con GitHub Actions, no hay que custodiar ninguna llave y
cuesta menos que un café al mes.

### Cuando haya certificado

La firma se hace en el mismo flujo que compila Windows
(`.github/workflows/windows.yml`), añadiendo un paso de firma antes de subir los
instaladores y guardando las credenciales como secretos del repositorio. Tauri
lo admite de serie con `signCommand` en `tauri.conf.json` (bundle → windows).
No hay que cambiar nada del código de la app.

Fuentes: [Trusted Signing para desarrolladores individuales](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554)
· [precios](https://azure.microsoft.com/en-us/pricing/details/trusted-signing/)
· [envío de falsos positivos a Microsoft](https://www.microsoft.com/en-us/wdsi/filesubmission)
