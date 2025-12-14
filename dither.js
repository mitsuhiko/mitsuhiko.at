(function() {
  const canvas = document.getElementById('background-canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) return;

  const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
      v_texCoord = a_texCoord;
    }
  `;

  const fsSource = `
    precision highp float;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    varying vec2 v_texCoord;

    const float PIXEL_SIZE = 3.0;

    float atkinsonThreshold(vec2 pos) {
      int x = int(mod(pos.x, 4.0));
      int y = int(mod(pos.y, 4.0));
      int idx = y * 4 + x;
      float thresholds[16];
      thresholds[0] = 0.0;   thresholds[1] = 12.0;  thresholds[2] = 3.0;   thresholds[3] = 15.0;
      thresholds[4] = 8.0;   thresholds[5] = 4.0;   thresholds[6] = 11.0;  thresholds[7] = 7.0;
      thresholds[8] = 2.0;   thresholds[9] = 14.0;  thresholds[10] = 1.0;  thresholds[11] = 13.0;
      thresholds[12] = 10.0; thresholds[13] = 6.0;  thresholds[14] = 9.0;  thresholds[15] = 5.0;
      for (int i = 0; i < 16; i++) {
        if (i == idx) return thresholds[i] / 16.0;
      }
      return 0.0;
    }

    void main() {
      vec4 color = texture2D(u_image, v_texCoord);
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Atkinson-style contrast boost
      gray = gray * 1.2 - 0.1;
      gray = clamp(gray, 0.0, 1.0);

      vec2 scaledCoord = floor(gl_FragCoord.xy / PIXEL_SIZE);
      float threshold = atkinsonThreshold(scaledCoord);
      float dithered = step(threshold + 0.1, gray);

      vec3 dark = vec3(0.0, 0.02, 0.08);
      vec3 light = vec3(0.067, 0.36, 0.63);    // #115ca1
      gl_FragColor = vec4(mix(dark, light, dithered), 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const texLoc = gl.getAttribLocation(program, 'a_texCoord');
  gl.enableVertexAttribArray(texLoc);

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.src = 'background_blue.mp4';

  const fallbackImage = new Image();
  fallbackImage.crossOrigin = 'anonymous';
  fallbackImage.src = 'background_blue_fallback.jpg';

  let texture = null;
  let texBuffer = null;
  let resolutionLoc = null;
  let animationId = null;
  let currentSource = null;  // 'video' or 'image'
  let videoPlaying = false;

  function setupCanvas(source) {
    const sourceWidth = source === video ? video.videoWidth : fallbackImage.naturalWidth;
    const sourceHeight = source === video ? video.videoHeight : fallbackImage.naturalHeight;
    if (!sourceWidth || !sourceHeight) return;

    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const canvasAspect = canvas.width / canvas.height;
    const sourceAspect = sourceWidth / sourceHeight;
    let texTop = 1, texBottom = 0, texLeft = 0, texRight = 1;
    if (sourceAspect > canvasAspect) {
      const scale = canvasAspect / sourceAspect;
      texLeft = (1 - scale) / 2;
      texRight = 1 - texLeft;
    } else {
      const scale = sourceAspect / canvasAspect;
      texTop = scale;
      texBottom = 0;
    }

    if (!texBuffer) {
      texBuffer = gl.createBuffer();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      texLeft, texBottom,   texRight, texBottom,
      texLeft, texTop,      texRight, texTop
    ]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    if (!texture) {
      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    }

    resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    gl.uniform2f(resolutionLoc, canvas.width, canvas.height);

    currentSource = source === video ? 'video' : 'image';
  }

  function render() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const source = currentSource === 'video' ? video : fallbackImage;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Only keep animating if video is playing, otherwise static image is fine
    if (currentSource === 'video' && videoPlaying) {
      animationId = requestAnimationFrame(render);
    }
  }

  function tryPlayVideo() {
    if (videoPlaying) return;
    video.play().then(function() {
      videoPlaying = true;
      // Switch to video source if we were showing fallback
      if (currentSource === 'image' && video.readyState >= 2) {
        setupCanvas(video);
      }
      if (!animationId) {
        render();
      }
    }).catch(function() {
      // Autoplay blocked - we'll try again on user interaction
    });
  }

  // Try to start video on first user interaction (mobile Safari workaround)
  function onFirstInteraction() {
    tryPlayVideo();
    document.removeEventListener('click', onFirstInteraction);
    document.removeEventListener('touchstart', onFirstInteraction);
    document.removeEventListener('keydown', onFirstInteraction);
    document.removeEventListener('scroll', onFirstInteraction);
  }

  document.addEventListener('click', onFirstInteraction);
  document.addEventListener('touchstart', onFirstInteraction);
  document.addEventListener('keydown', onFirstInteraction);
  document.addEventListener('scroll', onFirstInteraction);

  // Start with fallback image if it loads first
  fallbackImage.addEventListener('load', function() {
    if (!currentSource) {
      setupCanvas(fallbackImage);
      render();
    }
  });

  video.addEventListener('loadeddata', function() {
    // If video loads, try to play it
    video.play().then(function() {
      videoPlaying = true;
      setupCanvas(video);
      render();
    }).catch(function() {
      // Autoplay blocked - use fallback image if available
      if (fallbackImage.complete && fallbackImage.naturalWidth) {
        setupCanvas(fallbackImage);
        render();
      }
      // Will retry on user interaction
    });
  });

  window.addEventListener('resize', function() {
    if (currentSource === 'video' && video.readyState >= 2) {
      setupCanvas(video);
    } else if (currentSource === 'image' && fallbackImage.complete) {
      setupCanvas(fallbackImage);
    }
  });
})();
