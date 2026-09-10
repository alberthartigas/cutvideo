# Windows: el aviso de SmartScreen y los antivirus

CutVideo se compila en GitHub Actions a partir del código de este repositorio,
pero el `.exe` **no va firmado**, y en Windows eso se nota: SmartScreen avisa de
un «editor desconocido» y Defender le pasa el antivirus antes de dejarlo correr.
No es que la app haga nada raro; es que Windows desconfía por defecto de
cualquier programa sin certificado y sin historial de descargas.

El flujo de compilación ya sabe firmar: en cuanto haya certificado se activa
solo, sin tocar nada. Cómo conseguir uno gratis está más abajo, en
[Poner en marcha la firma gratuita](#poner-en-marcha-la-firma-gratuita).

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
| **SignPath Foundation** | **gratis** | Que el proyecto sea open source y lo aprueben ellos; hay que solicitarlo | Reputación que se va ganando |
| **Azure Artifact Signing** (antes Trusted Signing) | 9,99 $/mes (5.000 firmas) | Cuenta de Azure y validación de identidad; ya admite desarrolladores individuales | Reconocido desde el primer día |
| **Certum Open Source Code Signing** | ~100 €/año | Verificación de identidad + lector y tarjeta criptográfica (se envían por correo) | Reputación que se va ganando |
| **Certificado EV** (SSL.com, DigiCert…) | 300–600 $/año | Empresa registrada + token físico | Confianza inmediata |

CutVideo es MIT, público y se compila en GitHub Actions, que es justo el perfil
que **SignPath Foundation** patrocina, así que es por donde conviene empezar: es
gratis y no hay que custodiar ninguna llave. Lo único que no da es reputación
inmediata en SmartScreen; eso se gana con descargas. Si algún día corre prisa
que el aviso desaparezca desde el primer día, Azure Artifact Signing lo hace por
9,99 $/mes.

## Poner en marcha la firma gratuita

El flujo de Windows ya está preparado: `.github/workflows/windows.yml` tiene un
job `firmar` que se salta solo mientras no haya credenciales, y se activa en
cuanto existan. No hay que tocar el workflow, solo hacer esto una vez:

1. Solicita el patrocinio en <https://signpath.org/apply> con la URL del
   repositorio. Piden proyecto open source, repositorio público y compilación en
   un CI público: los tres se cumplen.
2. Cuando lo aprueben, crea en SignPath un proyecto y una política de firma. Si
   no los llamas `cutvideo` y `release-signing`, cambia `project-slug` y
   `signing-policy-slug` en el paso «Firmar en SignPath» del workflow.
3. Guarda las dos credenciales como secretos del repositorio:

   ```bash
   gh secret set SIGNPATH_API_TOKEN --repo alberthartigas/cutvideo
   gh secret set SIGNPATH_ORGANIZATION_ID --repo alberthartigas/cutvideo
   ```

4. Publica una release como siempre. En la pestaña Actions debe aparecer el job
   `firmar`; si sigue saliendo el aviso «Sin credenciales de SignPath», es que
   algún secreto no está puesto.

En SignPath conviene configurar el proyecto para que firme **también los
ejecutables de dentro** del instalador (`cutvideo.exe`, `ffmpeg.exe`,
`ffprobe.exe`), no solo el `.exe` de fuera. Se hace en la configuración de
artefactos de su panel, no desde aquí.

### El detalle que rompe el actualizador si se olvida

Tauri calcula la firma del actualizador sobre el instalador recién empaquetado.
Al firmarlo con Authenticode **cambian los bytes**, así que esa firma deja de
valer: el actualizador se baja la versión nueva, no le cuadra y la rechaza. Por
eso el workflow llama a `scripts/refirmar-windows.sh`, que vuelve a firmar con
la clave de Tauri y rehace el `latest.json` antes de que se junten las
plataformas. Si alguna vez se cambia de proveedor de firma, eso hay que
mantenerlo.

La primera release firmada conviene mirarla de cerca: que el instalador ya no
avise de «editor desconocido» y que **Acerca de → Buscar actualizaciones**
instale de verdad desde la versión anterior.

Fuentes: [SignPath Foundation](https://signpath.org/apply)
· [Trusted Signing para desarrolladores individuales](https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554)
· [precios](https://azure.microsoft.com/en-us/pricing/details/trusted-signing/)
· [envío de falsos positivos a Microsoft](https://www.microsoft.com/en-us/wdsi/filesubmission)
