# Broker de modelos

La página que se sirve en `models`, `m1` y `m2` `.elffuss.com` (y, mientras
dura el cambio de dominio, también en los mismos hosts de `.elffuss.utopiaia.com`,
que siguen sirviendo sin redirigir). Se embebe como iframe oculto desde las webs
de Elffuss y guarda los modelos en el almacén del navegador, para que se
descarguen **una vez** en vez de en cada sesión.

Solo responde a las webs de Elffuss que lo embeben: `elffuss.com` y `claw`,
`code`, `t2t`, `translator`, `copilot`, `models`, `m1`, `m2`… `.elffuss.com`, lo
mismo bajo `elffuss.utopiaia.com`, los alias viejos `elffuss-claw` y
`elffuss-code` `.utopiaia.com`, y `localhost` en desarrollo. No a todo
`*.utopiaia.com`, y tampoco a todo `*.elffuss.com`: `git.*` es un Gitea que pinta
markdown escrito por cualquiera y, al ser del mismo site, un script colado ahí
hablaría con el broker en su caché compartida; `key.*` no lo necesita.

Estaba solo en el servidor, editada a mano. Se versiona aquí porque lleva
lógica que costó encontrar y que se perdería con un despliegue o una limpieza.

## Lo que NO es obvio y hay que respetar

**Guarda TROCEADO en partes de 1 GiB.** El navegador corta un fichero suelto
sobre los **1,94 GB** —medido— pase lo que pase con la cuota. Un modelo de
3,8 GB en un solo fichero fallaba con «exceed its storage quota», que suena a
falta de espacio y no lo es: es el tope por fichero. Con el troceado entra.

**El marcador `.done` guarda tamaño y número de partes.** Sin eso, un fichero
truncado por un desalojo del navegador se lee sin error y el modelo sale con
basura dentro.

**Juntar las partes con `new Blob(partes)` no copia los bytes:** el navegador
guarda referencias a los ficheros, así que no se traga los gigabytes en memoria.

## Cómo se despliega

Los docroots se llaman como el host anterior:

    scp server/broker/index.html <host>:/tmp/br.html
    ssh <host> 'for h in models m1 m2; do
      sudo cp /tmp/br.html /var/www/$h.elffuss.utopiaia.com/index.html; done'

## Cómo se comprueba que cachea de verdad

Por TIEMPOS no vale: la caché HTTP del navegador imita a un almacén compartido y
las dos responden en milisegundos. El único testigo fiable es contar las
peticiones que llegan al servidor:

    sudo grep -c "<fichero>" /var/log/nginx/access.log

Si la segunda carga no añade ninguna, vino del almacén. Medido así: 357 s la
primera vez y 35 s la segunda, con cero peticiones nuevas.
