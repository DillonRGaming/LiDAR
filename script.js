import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.169/examples/jsm/webxr/ARButton.js';

let container, scene, camera, renderer;
let pointCloudGeometry, pointCloud;
const maxPoints = 50000; // Reduced for better performance
let referenceSpace = null;
let pointCount = 0;
let depthSupported = false;

// Status display
const statusEl = document.getElementById('status');
function updateStatus(msg) {
  console.log(msg);
  statusEl.textContent = msg;
}

// Initialize
container = document.createElement('div');
container.id = 'canvas-container';
document.body.appendChild(container);

scene = new THREE.Scene();
camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// Point cloud setup
pointCloudGeometry = new THREE.BufferGeometry();
pointCloudGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
const material = new THREE.PointsMaterial({ 
  color: 0x00ffff, // Cyan for better visibility
  size: 0.01, // Slightly larger
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.9
});
pointCloud = new THREE.Points(pointCloudGeometry, material);
scene.add(pointCloud);

// Lightweight UI container
const uiContainer = document.createElement('div');
uiContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
document.body.appendChild(uiContainer);

// AR Button with OPTIONAL depth sensing
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ['hit-test'], // Only require hit-test
  optionalFeatures: ['depth-sensing', 'dom-overlay'], // Make depth optional
  depthSensing: { 
    usagePreference: ['cpu-optimized'],
    dataFormatPreference: ['luminance-alpha']
  },
  domOverlay: { root: uiContainer }
});
arButton.textContent = 'Start AR';
document.body.appendChild(arButton);

// Check depth support
renderer.xr.addEventListener('sessionstart', async (e) => {
  updateStatus('AR session starting...');
  const session = renderer.xr.getSession();
  
  // Check if depth sensing was actually enabled
  depthSupported = session.enabledFeatures?.includes('depth-sensing');
  updateStatus(depthSupported ? 'Depth sensing ENABLED' : 'Depth sensing NOT supported - using fallback');
  
  referenceSpace = await session.requestReferenceSpace('local');
  updateStatus('AR ready! Point camera at surfaces');
  
  // Add a test cube at origin to verify rendering
  if (!depthSupported) {
    const testCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    testCube.position.set(0, 0, -0.5);
    scene.add(testCube);
  }
});

renderer.xr.addEventListener('sessionend', () => {
  updateStatus('AR session ended');
  referenceSpace = null;
  pointCount = 0;
  globalPoints.length = 0;
});

// Main render loop
function render(timestamp, frame) {
  if (frame && referenceSpace) {
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) {
      const view = pose.views[0];
      
      // Try depth first, fallback to simple point placement
      if (depthSupported) {
        try {
          const depthInfo = frame.getDepthInformation(view);
          if (depthInfo) {
            const { width, height, data } = depthInfo;
            const newPoints = [];
            const step = 10; // Increased for performance
            
            for (let y = 0; y < height; y += step) {
              for (let x = 0; x < width; x += step) {
                const idx = (y * width + x) * 4;
                const depthRaw = data[idx] + (data[idx + 1] << 8);
                const depth = depthRaw * depthInfo.rawValueToMeters;
                
                if (depth > 0.1 && depth < 3) {
                  const ndcX = (x / width) * 2 - 1;
                  const ndcY = 1 - (y / height) * 2;
                  
                  const pointClip = new THREE.Vector4(ndcX, ndcY, -depth, 1);
                  const invProj = new THREE.Matrix4().copy(view.projectionMatrix).invert();
                  const pointView = pointClip.applyMatrix4(invProj);
                  const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
                  const pointWorld = pointView.applyMatrix4(matrix);
                  
                  newPoints.push(pointWorld.x, pointWorld.y, pointWorld.z);
                }
              }
            }
            
            addPoints(newPoints);
          }
        } catch (e) {
          console.warn('Depth error:', e);
          depthSupported = false;
        }
      }
      
      // Fallback: add points directly in front of camera if no depth
      if (!depthSupported && Math.random() < 0.1) {
        const fallbackPoints = [];
        for (let i = 0; i < 5; i++) {
          const point = new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            -Math.random() * 2 - 0.5
          );
          fallbackPoints.push(point.x, point.y, point.z);
        }
        addPoints(fallbackPoints);
      }
    }
  }
  
  renderer.render(scene, camera);
}

// Helper to add points
function addPoints(newPoints) {
  if (newPoints.length > 0 && pointCount + newPoints.length / 3 <= maxPoints) {
    const positions = pointCloudGeometry.attributes.position.array;
    const startIdx = pointCount * 3;
    positions.set(newPoints, startIdx);
    pointCloudGeometry.attributes.position.needsUpdate = true;
    pointCloudGeometry.setDrawRange(0, pointCount + newPoints.length / 3);
    pointCount += newPoints.length / 3;
  }
}

renderer.setAnimationLoop(render);

// Export button
const exportBtn = document.createElement('button');
exportBtn.textContent = 'Export';
exportBtn.style.cssText = 'position:absolute;bottom:20px;left:20px;padding:10px;pointer-events:auto;z-index:100;background:#fff;border:none;border-radius:5px;cursor:pointer;';
exportBtn.onclick = () => {
  const positions = pointCloudGeometry.attributes.position.array;
  const points = Array.from(positions.slice(0, pointCount * 3));
  const blob = new Blob([JSON.stringify({ points, count: pointCount })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pointcloud.json';
  a.click();
  updateStatus('Exported!');
};
uiContainer.appendChild(exportBtn);

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Check WebXR support
if (!navigator.xr) {
  updateStatus('WebXR NOT supported - use Chrome on Android');
}