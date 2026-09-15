/*
 * blue-cat.js — the rider model: an ES-module copy of the codex concept.
 *
 * Adapted from codex-concepts/blue-cat.js (Concept 01, blue cat orb rider),
 * the standalone Babylon.js character study a colleague produced. The geometry
 * below is that file's, line for line, and exactly two things changed:
 *
 *   1. The ear meshes carry uvs now. ear() builds its triangular prism by hand
 *      and set positions, indices and normals only, while every MeshBuilder
 *      mesh in here also has uvs. Mesh.MergeMeshes wants one consistent
 *      attribute set across everything it merges, and rider.js merges the whole
 *      cat into a single mesh, so an ear with no uvs either drops the channel
 *      for the entire model or fails the merge outright. Twelve zeroes (six
 *      vertices x two) cost nothing: no material in here samples a texture.
 *   2. It is `export function createBlueCat(scene)` rather than a global,
 *      because the game is ES modules over HTTP. BABYLON itself is still the
 *      UMD global pinned in index.html, not an import — see that file.
 *
 * Nothing else about the model changed, including the conventions the rest of
 * the game leans on: the character faces -Z with Y up, the orb's centre sits at
 * Y = 0.78 and it is 1.44 across. rider.js turns those model units into arena
 * units and does all the tinting; this file stays the concept's own colours.
 */

/* Concept 01. Standalone Babylon.js mesh factory. Forward is -Z; units are arbitrary. */
export function createBlueCat(scene) {
  const B = BABYLON;
  const root = new B.TransformNode('blue-cat-rider', scene);
  const materials = {};
  function material(name, hex, glow = 0) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(glow);
    m.specularColor = new B.Color3(.18, .22, .28);
    materials[name] = m;
    return m;
  }
  const blue = material('cobalt-fur', '#2377d7');
  const pale = material('cream-muzzle', '#e5f5ff');
  const pink = material('inner-ear', '#ed91b7');
  const dark = material('midnight-suit', '#14243c');
  const cyan = material('cyan-trim', '#51eaff', .65);
  const black = material('pupils-and-nose', '#071222');
  const orbMat = material('orb-core', '#087ead', .55);
  const light = material('orb-rings', '#6df4ff', 1);

  function ellipsoid(name, position, scale, mat, segments = 12) {
    const mesh = B.MeshBuilder.CreateSphere(name, { diameter: 1, segments }, scene);
    mesh.position.set(...position);
    mesh.scaling.set(...scale);
    mesh.material = mat;
    mesh.parent = root;
    return mesh;
  }
  function tube(name, points, radius, mat) {
    const mesh = B.MeshBuilder.CreateTube(name, {
      path: points.map(p => new B.Vector3(...p)), radius, tessellation: 8,
      cap: B.Mesh.CAP_ALL
    }, scene);
    mesh.material = mat;
    mesh.parent = root;
    return mesh;
  }
  function ear(name, x, mat, inset = false) {
    // A shallow triangular prism gives the ears a clear silhouette from above.
    const width = inset ? .21 : .36;
    const bottom = inset ? 2.20 : 2.13;
    const top = inset ? 2.62 : 2.78;
    const front = inset ? -.635 : -.61;
    const back = inset ? -.61 : -.30;
    const vertices = [x-width,bottom,front, x+width,bottom,front, x*1.18,top,front,
      x-width,bottom,back, x+width,bottom,back, x*1.18,top,back];
    const indices = [0,2,1, 3,4,5, 0,1,4, 0,4,3, 1,2,5, 1,5,4, 2,0,3, 2,3,5];
    const normals = [];
    B.VertexData.ComputeNormals(vertices, indices, normals);
    const data = new B.VertexData();
    data.positions = vertices; data.indices = indices; data.normals = normals;
    // Six vertices x two coordinates of nothing: the only reason this channel
    // exists is so the ears merge with the MeshBuilder meshes (see the header).
    data.uvs = new Array(12).fill(0);
    const mesh = new B.Mesh(name, scene);
    data.applyToMesh(mesh);
    mesh.material = mat; mesh.parent = root;
  }

  ellipsoid('gliding-orb', [0,.78,0], [1.44,1.44,1.44], orbMat, 24);
  for (let i = 0; i < 3; i++) {
    const ring = B.MeshBuilder.CreateTorus('energy-ring-' + i,
      { diameter: 1.48, thickness: .025, tessellation: 64 }, scene);
    ring.position.y = .78;
    ring.rotation.set(i * .72, 0, .35 + i * .68);
    ring.material = light; ring.parent = root;
  }

  // Compact suit, haunches, and paws straddling the orb.
  const torso = ellipsoid('suit', [0,1.57,.10], [.72,.85,.67], dark);
  torso.rotation.x = -.35;
  ellipsoid('chest-patch', [0,1.68,-.24], [.45,.51,.16], pale);
  for (const side of [-1, 1]) {
    ellipsoid('haunch', [side*.40,1.40,.23], [.39,.44,.55], blue);
    ellipsoid('boot', [side*.52,1.14,-.03], [.35,.27,.49], dark);
    tube('reaching-arm', [[side*.31,1.79,-.14], [side*.48,1.56,-.43],
      [side*.46,1.39,-.65]], .115, blue);
    ellipsoid('cuff', [side*.46,1.43,-.60], [.30,.15,.27], cyan);
    ellipsoid('paw', [side*.46,1.34,-.70], [.31,.22,.31], dark);
    for (let toe = -1; toe <= 1; toe++) {
      ellipsoid('paw-tip', [side*.46+toe*.075,1.33,-.84], [.065,.08,.085], pale, 8);
    }
  }

  ellipsoid('oversized-head', [0,2.03,-.40], [1.14,.91,.87], blue, 16);
  for (const side of [-1, 1]) {
    ear('ear', side*.40, blue);
    ear('ear-inset', side*.40, pink, true);
    ellipsoid('cheek', [side*.27,1.89,-.73], [.49,.32,.31], pale);
    ellipsoid('eye-white', [side*.27,2.13,-.785], [.34,.36,.13], pale);
    ellipsoid('iris', [side*.25,2.12,-.85], [.19,.25,.075], cyan);
    ellipsoid('pupil', [side*.24,2.12,-.889], [.082,.20,.038], black);
    ellipsoid('eye-spark', [side*.24-.035,2.18,-.91], [.055,.065,.025], pale, 8);
    const brow = ellipsoid('brow', [side*.28,2.33,-.78], [.39,.075,.12], blue);
    brow.rotation.z = side * -.19;
  }
  ellipsoid('nose', [0,1.98,-.929], [.14,.10,.095], pink, 8);
  tube('smile', [[-.15,1.86,-.896], [0,1.82,-.918], [.15,1.86,-.896]], .018, black);
  tube('collar', [[-.33,1.76,-.29], [0,1.69,-.36], [.33,1.76,-.29]], .055, cyan);

  const tailPath = B.Curve3.CreateCatmullRomSpline([
    new B.Vector3(0,1.48,.37), new B.Vector3(.15,1.61,.84),
    new B.Vector3(.32,1.94,1.12), new B.Vector3(.20,2.30,1.13),
    new B.Vector3(-.10,2.46,.96), new B.Vector3(-.34,2.35,.87)
  ], 7).getPoints().map(v => [v.x,v.y,v.z]);
  tube('curled-tail', tailPath, .18, blue);
  ellipsoid('tail-tip', [-.34,2.35,.87], [.39,.37,.37], pale);
  return { root, materials };
}
