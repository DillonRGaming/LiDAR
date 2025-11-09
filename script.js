import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169/build/three.module.js';
import { ARButton } from 'https://cdn.jsdelivr.net/npm/three@0.169/examples/jsm/webxr/ARButton.js';

let container, scene, camera, renderer;
let pointCloudGeometry, pointCloud;
const globalPoints = [];
const maxPoints = 100000;
let referenceSpace = null;
let pointCount = 0;

// Initialize container
container = document.createElement('div');
document.body.appendChild(container);

// Scene setup
scene = new THREE.Scene();
camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

// Renderer setup
renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// Point cloud setup
pointCloudGeometry = new THREE.BufferGeometry();
pointCloudGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
const material = new THREE.PointsMaterial({ 
  color: 0xffffff, 
  size: 0.005, 
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.8
});
pointCloud = new THREE.Points(pointCloudGeometry, material);
scene.add(pointCloud);

// Overlay container for UI
const overlayContainer = document.createElement('div');
overlayContainer.style.position = 'absolute';
overlayContainer.style.top = '0';
overlayContainer.style.left = '0';
overlayContainer.style.width = '100%';
overlayContainer.style.height = '100%';
overlayContainer.style.pointerEvents = 'none';
document.body.appendChild(overlayContainer);

// AR Button
const button = ARButton.createButton(renderer, {
  requiredFeatures: ['hit-test', 'depth-sensing', 'dom-overlay'],
  depthSensing: { 
    usagePreference: ['cpu-optimized'],
    dataFormatPreference: ['luminance-alpha']
  },
  domOverlay: { root: overlayContainer }
});
button.textContent = 'Start AR';
document.body.appendChild(button);

// XR event listeners
renderer.xr.addEventListener('sessionstart', async (e) => {
  console.log('AR session started!');
  const session = renderer.xr.getSession();
  referenceSpace = await session.requestReferenceSpace('local');
  
  if (!session.depthSensingState) {
    console.warn('Depth sensing not supported on this device');
    alert('Depth sensing not supported. Try Chrome on Android with ARCore.');
  }
});

renderer.xr.addEventListener('sessionend', () => {
  console.log('AR session ended.');
  referenceSpace = null;
});

// Render loop
function render(timestamp, frame) {
  if (frame && referenceSpace) {
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) {
      const view = pose.views[0];
      
      try {
        const depthInfo = frame.getDepthInformation(view);
        if (depthInfo) {
          const { width, height, data } = depthInfo;
          const newPoints = [];
          
          const step = 8;
          for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
              const idx = (y * width + x) * 4;
              const depthRaw = data[idx] + (data[idx + 1] << 8);
              const depth = depthRaw * depthInfo.rawValueToMeters;
              
              if (depth > 0.1 && depth < 5) {
                const ndcX = (x / width) * 2 - 1;
                const ndcY = 1 - (y / height) * 2;
                
                const pointClip = new THREE.Vector4(ndcX, ndcY, 0, 1);
                pointClip.z = -depth;
                
                const invProj = new THREE.Matrix4().copy(view.projectionMatrix).invert();
                const pointView = pointClip.applyMatrix4(invProj);
                pointView.z = -depth;
                
                const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
                const pointWorld = pointView.applyMatrix4(matrix);
                
                newPoints.push(pointWorld.x, pointWorld.y, pointWorld.z);
              }
            }
          }
          
          if (newPoints.length > 0 && pointCount + newPoints.length / 3 <= maxPoints) {
            const positions = pointCloudGeometry.attributes.position.array;
            const startIdx = pointCount * 3;
            positions.set(newPoints, startIdx);
            pointCloudGeometry.attributes.position.needsUpdate = true;
            pointCloudGeometry.setDrawRange(0, pointCount + newPoints.length / 3);
            pointCount += newPoints.length / 3;
            console.log('Points added:', newPoints.length / 3, 'Total:', pointCount);
          }
        } else if (Math.random() < 0.01) {
          console.warn('No depth info available');
        }
      } catch (error) {
        console.error('Depth processing error:', error);
      }
    }
  }
  
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(render);

// Export button
const exportButton = document.createElement('button');
exportButton.textContent = 'Export Point Cloud';
exportButton.style.cssText = 'position:absolute;bottom:20px;left:20px;padding:10px;pointer-events:auto;z-index:100;background:#fff;border:none;border-radius:5px;cursor:pointer;';
exportButton.onclick = () => {
  console.log(`Exporting ${pointCount} points...`);
  // Add export logic here
};
overlayContainer.appendChild(exportButton);

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});