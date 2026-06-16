"""
AI Asset Intelligence Service

Provides comprehensive AI analysis capabilities for MediaAsset objects including:
- GPT-4 Vision analysis for images and videos
- Semantic embedding generation for vector search
- OMC metadata auto-population
- Smart categorization and tagging
- Production context analysis
"""

import asyncio
import base64
import json
import logging
import mimetypes
import os
import shutil
import ssl
import tempfile
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path

import aiohttp
import certifi
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Framework Python on macOS ships without root CAs wired up; pin certifi's
# bundle so TLS to the OpenAI API verifies everywhere.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def _http_session() -> aiohttp.ClientSession:
    return aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(ssl=_SSL_CONTEXT),
        timeout=aiohttp.ClientTimeout(total=90),
    )


class AIAssetIntelligenceService:
    """
    AI-powered asset intelligence service using OpenAI APIs.
    
    Provides comprehensive analysis of media assets for CG production workflows.
    """
    
    def __init__(self):
        self.openai_api_key = getattr(settings, 'OPENAI_API_KEY', os.getenv('OPENAI_API_KEY'))
        self.openai_base_url = "https://api.openai.com/v1"
        
        if not self.openai_api_key:
            logger.warning("OpenAI API key not configured. AI features will be disabled.")
    
    async def analyze_asset_comprehensive(self, media_asset) -> Dict[str, Any]:
        """
        Perform comprehensive AI analysis of a MediaAsset.
        
        Args:
            media_asset: MediaAsset instance to analyze
            
        Returns:
            Dict containing all analysis results
        """
        if not self.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        
        logger.info(f"Starting AI analysis for asset: {media_asset.code}")
        
        # Determine analysis strategy based on media type
        if media_asset.is_image():
            return await self._analyze_image_asset(media_asset)
        elif media_asset.is_3d_model():
            return await self._analyze_3d_model_asset(media_asset)
        elif media_asset.is_video():
            return await self._analyze_video_asset(media_asset)
        else:
            return await self._analyze_generic_asset(media_asset)
    
    async def _analyze_image_asset(self, media_asset) -> Dict[str, Any]:
        """Analyze image assets using GPT-4 Vision."""
        try:
            # Load and encode image — prefer the 1024px rendition when one
            # exists (smaller payload, faster + cheaper vision call).
            thumbnails = (media_asset.type_data or {}).get("thumbnails") or {}
            source_path = thumbnails.get("1024") or media_asset.file_path
            image_data, image_mime = await self._load_and_encode_image(source_path)

            # Prepare GPT-4 Vision prompt
            prompt = self._build_image_analysis_prompt(media_asset)

            # Call GPT-4 Vision API
            vision_response = await self._call_gpt4_vision(image_data, prompt, image_mime)
            
            # Generate semantic embedding
            embedding = await self.generate_embedding(vision_response.get('description', ''))
            
            # Parse and structure results
            analysis_results = {
                'description': vision_response.get('description', ''),
                'tags': vision_response.get('tags', []),
                'confidence_score': vision_response.get('confidence_score', 0.0),
                'embedding': embedding,
                'suggested_omc_type': vision_response.get('omc_type', ''),
                'technical_metadata': vision_response.get('technical_metadata', {}),
                'creative_metadata': vision_response.get('creative_metadata', {}),
                'production_stage': vision_response.get('production_stage', ''),
                'quality_score': vision_response.get('quality_score')
            }
            
            logger.info(f"Image analysis completed for {media_asset.code}")
            return analysis_results
            
        except Exception as e:
            logger.error(f"Error analyzing image asset {media_asset.code}: {str(e)}")
            raise
    
    async def _analyze_3d_model_asset(self, media_asset) -> Dict[str, Any]:
        """Analyze 3D model assets."""
        try:
            # For 3D models, we analyze based on filename and metadata
            file_info = await self._extract_file_metadata(media_asset.file_path)
            
            # Build analysis prompt
            prompt = self._build_3d_model_analysis_prompt(media_asset, file_info)
            
            # Call GPT-4 for analysis
            response = await self._call_gpt4_text(prompt)
            
            # Generate embedding
            embedding = await self.generate_embedding(response.get('description', ''))
            
            return {
                'description': response.get('description', ''),
                'tags': response.get('tags', []),
                'confidence_score': response.get('confidence_score', 0.8),
                'embedding': embedding,
                'suggested_omc_type': 'digital.3dModel',
                'technical_metadata': file_info,
                'creative_metadata': response.get('creative_metadata', {}),
                'production_stage': response.get('production_stage', ''),
                'quality_score': response.get('quality_score')
            }
            
        except Exception as e:
            logger.error(f"Error analyzing 3D model {media_asset.code}: {str(e)}")
            raise
    
    async def _analyze_video_asset(self, media_asset) -> Dict[str, Any]:
        """Analyze video/animation assets by sampling keyframes with GPT-4 Vision.

        Falls back to filename/metadata text analysis when ffmpeg is unavailable
        or no frames can be extracted, preserving the previous behaviour.
        """
        try:
            video_info = await self._extract_video_metadata(media_asset.file_path)

            frames = []
            try:
                frames = await self._extract_keyframes(
                    media_asset.file_path,
                    duration=video_info.get("duration"),
                )
            except Exception as e:
                logger.warning(
                    f"Keyframe extraction failed for {media_asset.code}: {e}"
                )

            prompt = self._build_video_analysis_prompt(
                media_asset, video_info, has_frames=bool(frames)
            )

            if frames:
                response = await self._call_gpt4_vision(frames, prompt)
                default_confidence = 0.85
            else:
                # No frames (ffmpeg missing / extraction failed): degrade to the
                # previous filename + metadata text analysis.
                response = await self._call_gpt4_text(prompt)
                default_confidence = 0.6

            embedding = await self.generate_embedding(response.get('description', ''))
            video_info = {**video_info, "keyframes_analyzed": len(frames)}

            return {
                'description': response.get('description', ''),
                'tags': response.get('tags', []),
                'confidence_score': response.get('confidence_score', default_confidence),
                'embedding': embedding,
                'suggested_omc_type': 'digital.movingImage',
                'technical_metadata': video_info,
                'creative_metadata': response.get('creative_metadata', {}),
                'production_stage': response.get('production_stage', ''),
                'quality_score': response.get('quality_score')
            }

        except Exception as e:
            logger.error(f"Error analyzing video asset {media_asset.code}: {str(e)}")
            raise
    
    async def _analyze_generic_asset(self, media_asset) -> Dict[str, Any]:
        """Analyze generic/unknown asset types."""
        try:
            file_info = await self._extract_file_metadata(media_asset.file_path)
            
            prompt = self._build_generic_analysis_prompt(media_asset, file_info)
            response = await self._call_gpt4_text(prompt)
            embedding = await self.generate_embedding(response.get('description', ''))
            
            return {
                'description': response.get('description', ''),
                'tags': response.get('tags', []),
                'confidence_score': response.get('confidence_score', 0.5),
                'embedding': embedding,
                'suggested_omc_type': 'digital.other',
                'technical_metadata': file_info,
                'creative_metadata': response.get('creative_metadata', {}),
                'production_stage': response.get('production_stage', 'unknown'),
                'quality_score': response.get('quality_score')
            }
            
        except Exception as e:
            logger.error(f"Error analyzing generic asset {media_asset.code}: {str(e)}")
            raise
    
    async def generate_embedding(self, text: str) -> List[float]:
        """
        Generate semantic embedding for text using OpenAI embeddings API.
        
        Args:
            text: Text to embed
            
        Returns:
            List of float values representing the embedding vector
        """
        if not text.strip():
            return None
        
        try:
            async with _http_session() as session:
                headers = {
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json"
                }
                
                data = {
                    "input": text,
                    "model": "text-embedding-3-small"  # 1536 dimensions
                }
                
                async with session.post(
                    f"{self.openai_base_url}/embeddings",
                    headers=headers,
                    json=data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result['data'][0]['embedding']
                    else:
                        error_text = await response.text()
                        logger.error(f"Embedding API error: {error_text}")
                        return None
                        
        except Exception as e:
            logger.error(f"Error generating embedding: {str(e)}")
            return None
    
    async def _call_gpt4_vision(self, images, prompt: str, mime: str = 'image/jpeg') -> Dict[str, Any]:
        """Call GPT-4 Vision API for image/video-frame analysis.

        ``images`` may be a single base64 string (with ``mime``), or a list of
        ``(base64_data, mime)`` tuples — e.g. keyframes sampled from a video,
        sent in one request so the model reasons about the clip as a whole.
        """
        if isinstance(images, str):
            images = [(images, mime)]

        image_blocks = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{frame_mime};base64,{frame_data}"},
            }
            for frame_data, frame_mime in images
        ]

        try:
            async with _http_session() as session:
                headers = {
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json"
                }

                messages = [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": prompt}] + image_blocks,
                    }
                ]
                
                data = {
                    "model": "gpt-4o",
                    "messages": messages,
                    "max_tokens": 1500,
                    "temperature": 0.1
                }
                
                async with session.post(
                    f"{self.openai_base_url}/chat/completions",
                    headers=headers,
                    json=data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        content = result['choices'][0]['message']['content']
                        return self._parse_ai_response(content)
                    else:
                        error_text = await response.text()
                        logger.error(f"GPT-4 Vision API error: {error_text}")
                        raise Exception(f"API call failed: {error_text}")
                        
        except Exception as e:
            logger.error(f"Error calling GPT-4 Vision: {str(e)}")
            raise
    
    async def _call_gpt4_text(self, prompt: str) -> Dict[str, Any]:
        """Call GPT-4 text API for analysis."""
        try:
            async with _http_session() as session:
                headers = {
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json"
                }
                
                data = {
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 1000,
                    "temperature": 0.1
                }
                
                async with session.post(
                    f"{self.openai_base_url}/chat/completions",
                    headers=headers,
                    json=data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        content = result['choices'][0]['message']['content']
                        return self._parse_ai_response(content)
                    else:
                        error_text = await response.text()
                        logger.error(f"GPT-4 API error: {error_text}")
                        raise Exception(f"API call failed: {error_text}")
                        
        except Exception as e:
            logger.error(f"Error calling GPT-4: {str(e)}")
            raise
    
    def _parse_ai_response(self, response_text: str) -> Dict[str, Any]:
        """Parse AI response text into structured data."""
        try:
            # Strip markdown code fences (```json ... ```) the model often adds
            text = response_text.strip()
            if text.startswith('```'):
                text = text.split('\n', 1)[1] if '\n' in text else text
                text = text.rsplit('```', 1)[0].strip()

            # Try to parse as JSON first
            if text.startswith('{'):
                return json.loads(text)
            
            # Otherwise, parse structured text response
            lines = response_text.strip().split('\n')
            result = {
                'description': '',
                'tags': [],
                'confidence_score': 0.7,
                'omc_type': '',
                'technical_metadata': {},
                'creative_metadata': {},
                'production_stage': '',
                'quality_score': None
            }
            
            current_section = None
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                if line.lower().startswith('description:'):
                    result['description'] = line.split(':', 1)[1].strip()
                elif line.lower().startswith('tags:'):
                    tags_text = line.split(':', 1)[1].strip()
                    result['tags'] = [tag.strip() for tag in tags_text.split(',')]
                elif line.lower().startswith('omc type:'):
                    result['omc_type'] = line.split(':', 1)[1].strip()
                elif line.lower().startswith('production stage:'):
                    result['production_stage'] = line.split(':', 1)[1].strip()
                elif line.lower().startswith('quality score:'):
                    try:
                        result['quality_score'] = float(line.split(':', 1)[1].strip())
                    except:
                        pass
                elif line.lower().startswith('confidence:'):
                    try:
                        result['confidence_score'] = float(line.split(':', 1)[1].strip())
                    except:
                        pass
            
            return result
            
        except Exception as e:
            logger.error(f"Error parsing AI response: {str(e)}")
            return {
                'description': response_text[:500],
                'tags': [],
                'confidence_score': 0.5,
                'omc_type': '',
                'technical_metadata': {},
                'creative_metadata': {},
                'production_stage': 'unknown',
                'quality_score': None
            }
    
    def _build_image_analysis_prompt(self, media_asset) -> str:
        """Build analysis prompt for image assets."""
        project_context = media_asset.get_project_context()
        
        return f"""
Analyze this image asset for a CG production pipeline. The asset is:
- Code: {media_asset.code}
- Name: {media_asset.name}
- Media Type: {media_asset.media_type}
- Project Context: {project_context}

Please provide a comprehensive analysis in JSON format with the following structure:
{{
    "description": "Detailed description of the visual content, style, and composition",
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
    "confidence_score": 0.95,
    "omc_type": "appropriate OMC asset functional type",
    "technical_metadata": {{
        "estimated_resolution": "resolution if visible",
        "color_palette": "dominant colors",
        "style": "artistic style"
    }},
    "creative_metadata": {{
        "mood": "emotional tone",
        "composition": "composition analysis",
        "lighting": "lighting description"
    }},
    "production_stage": "concept|wip|review|final",
    "quality_score": 0.85
}}

Focus on:
1. Visual content and artistic elements
2. Production context and stage
3. Technical quality assessment
4. OMC compliance categorization
5. Searchable tags for asset discovery
"""
    
    def _build_3d_model_analysis_prompt(self, media_asset, file_info) -> str:
        """Build analysis prompt for 3D model assets."""
        return f"""
Analyze this 3D model asset for CG production:
- Code: {media_asset.code}
- Name: {media_asset.name}
- File: {media_asset.file_path}
- File Info: {file_info}

Provide analysis in JSON format:
{{
    "description": "Description of the 3D model purpose and characteristics",
    "tags": ["3d_model", "geometry", "prop", "character", "environment"],
    "confidence_score": 0.8,
    "omc_type": "digital.3dModel",
    "technical_metadata": {{
        "file_format": "{Path(media_asset.file_path).suffix}",
        "estimated_complexity": "low|medium|high"
    }},
    "creative_metadata": {{
        "model_type": "character|prop|environment|vehicle",
        "style": "realistic|stylized|cartoon"
    }},
    "production_stage": "blocking|modeling|texturing|final",
    "quality_score": 0.8
}}
"""
    
    def _build_video_analysis_prompt(self, media_asset, video_info, has_frames: bool = False) -> str:
        """Build analysis prompt for video assets."""
        project_context = media_asset.get_project_context()

        if has_frames:
            intro = (
                "You are analyzing a video. Several keyframes sampled in "
                "chronological order across the clip are attached below. Base your "
                "analysis on what is actually visible: how many people appear and "
                "what they are doing (e.g. two people talking), their interactions, "
                "the setting, camera framing, and how the action progresses across "
                "the sequence. Write the description so it is useful for someone "
                "searching by content."
            )
        else:
            intro = (
                "Analyze this video/animation asset based on its filename and "
                "metadata only (no frames were available for visual inspection)."
            )

        return f"""{intro}

Asset:
- Code: {media_asset.code}
- Name: {media_asset.name}
- Media Type: {media_asset.media_type}
- Project Context: {project_context}
- Technical info: duration={video_info.get('duration')}s, resolution={video_info.get('resolution')}, fps={video_info.get('fps')}, codec={video_info.get('codec')}

Provide analysis in JSON format:
{{
    "description": "Detailed description of what happens in the video: people and how many, their actions and interactions, setting, and notable visual content",
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
    "confidence_score": 0.9,
    "omc_type": "digital.movingImage",
    "technical_metadata": {{}},
    "creative_metadata": {{
        "content_type": "animation|live_action|composite",
        "shot_type": "wide|medium|close|extreme_close",
        "mood": "emotional tone"
    }},
    "production_stage": "rough|animation|lighting|comp|final",
    "quality_score": 0.8
}}
"""
    
    def _build_generic_analysis_prompt(self, media_asset, file_info) -> str:
        """Build analysis prompt for generic assets."""
        return f"""
Analyze this digital asset:
- Code: {media_asset.code}
- Name: {media_asset.name}
- File: {media_asset.file_path}
- File Info: {file_info}

Provide basic analysis in JSON format:
{{
    "description": "General description based on filename and context",
    "tags": ["digital_asset", "file"],
    "confidence_score": 0.5,
    "omc_type": "digital.other",
    "technical_metadata": {file_info},
    "creative_metadata": {{}},
    "production_stage": "unknown",
    "quality_score": null
}}
"""
    
    @staticmethod
    def _resolve_media_path(file_path: str) -> str:
        """Map MEDIA_URL-style paths (/media/...) and relative paths to disk."""
        media_url = getattr(settings, 'MEDIA_URL', '/media/')
        media_root = getattr(settings, 'MEDIA_ROOT', '')
        if file_path.startswith(media_url):
            return os.path.join(media_root, file_path[len(media_url):])
        if not os.path.isabs(file_path):
            return os.path.join(media_root, file_path)
        return file_path

    async def _load_and_encode_image(self, file_path: str) -> Tuple[str, str]:
        """Load image file; return (base64 data, mime type)."""
        try:
            file_path = self._resolve_media_path(file_path)

            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Image file not found: {file_path}")

            mime = mimetypes.guess_type(file_path)[0] or 'image/jpeg'
            with open(file_path, 'rb') as image_file:
                image_data = image_file.read()
                return base64.b64encode(image_data).decode('utf-8'), mime

        except Exception as e:
            logger.error(f"Error loading image {file_path}: {str(e)}")
            raise
    
    async def _extract_file_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract basic file metadata."""
        try:
            if not os.path.isabs(file_path):
                media_root = getattr(settings, 'MEDIA_ROOT', '')
                file_path = os.path.join(media_root, file_path)
            
            if os.path.exists(file_path):
                stat = os.stat(file_path)
                path_obj = Path(file_path)
                
                return {
                    'file_size': stat.st_size,
                    'file_extension': path_obj.suffix.lower(),
                    'mime_type': mimetypes.guess_type(file_path)[0],
                    'modified_time': stat.st_mtime,
                    'filename': path_obj.name
                }
            else:
                return {
                    'file_extension': Path(file_path).suffix.lower(),
                    'filename': Path(file_path).name,
                    'mime_type': mimetypes.guess_type(file_path)[0]
                }
                
        except Exception as e:
            logger.error(f"Error extracting metadata for {file_path}: {str(e)}")
            return {}
    
    async def _extract_video_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract video metadata via ffprobe (duration, resolution, fps, codec).

        Returns the base file metadata with video fields left as None when
        ffprobe is unavailable or the probe fails.
        """
        file_info = await self._extract_file_metadata(file_path)
        file_info.update({
            'duration': None,
            'resolution': None,
            'fps': None,
            'codec': None,
        })

        ffprobe = shutil.which("ffprobe")
        disk_path = self._resolve_media_path(file_path)
        if not ffprobe or not os.path.exists(disk_path):
            return file_info

        args = [
            ffprobe, "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", disk_path,
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode != 0:
                return file_info

            probe = json.loads(stdout.decode() or "{}")
            fmt = probe.get("format", {})
            if fmt.get("duration"):
                file_info["duration"] = round(float(fmt["duration"]), 3)

            vstream = next(
                (s for s in probe.get("streams", []) if s.get("codec_type") == "video"),
                None,
            )
            if vstream:
                width, height = vstream.get("width"), vstream.get("height")
                if width and height:
                    file_info["resolution"] = f"{width}x{height}"
                file_info["codec"] = vstream.get("codec_name")
                rate = vstream.get("avg_frame_rate") or vstream.get("r_frame_rate")
                if rate and "/" in rate:
                    num, den = rate.split("/")
                    file_info["fps"] = round(float(num) / float(den), 3) if float(den) else None
        except Exception as e:
            logger.warning(f"ffprobe failed for {disk_path}: {e}")

        return file_info

    async def _extract_keyframes(
        self,
        file_path: str,
        max_frames: int = 8,
        duration: Optional[float] = None,
        max_dim: int = 512,
    ) -> List[Tuple[str, str]]:
        """Sample up to ``max_frames`` keyframes from a video using ffmpeg.

        Returns a list of ``(base64_jpeg, "image/jpeg")`` tuples in chronological
        order. Returns an empty list (rather than raising) when ffmpeg is not
        installed, so callers can fall back to text analysis.
        """
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            logger.warning("ffmpeg not found on PATH; skipping keyframe extraction")
            return []

        disk_path = self._resolve_media_path(file_path)
        if not os.path.exists(disk_path):
            raise FileNotFoundError(f"Video file not found: {disk_path}")

        # Evenly sample across the duration when known; otherwise fall back to
        # scene-change detection to grab visually distinct frames.
        if duration and duration > 0:
            vf = f"fps={max_frames}/{duration},scale='min({max_dim},iw)':-2"
        else:
            vf = f"select='gt(scene,0.3)',scale='min({max_dim},iw)':-2"

        with tempfile.TemporaryDirectory(prefix="kf_") as tmpdir:
            out_pattern = os.path.join(tmpdir, "frame_%03d.jpg")
            args = [
                ffmpeg, "-hide_banner", "-loglevel", "error",
                "-i", disk_path,
                "-vf", vf,
                "-vsync", "vfr",
                "-frames:v", str(max_frames),
                "-q:v", "5",
                out_pattern,
            ]
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    f"ffmpeg keyframe extraction failed ({disk_path}): "
                    f"{stderr.decode()[:500]}"
                )
                return []

            frames: List[Tuple[str, str]] = []
            for name in sorted(os.listdir(tmpdir)):
                with open(os.path.join(tmpdir, name), "rb") as fh:
                    frames.append(
                        (base64.b64encode(fh.read()).decode("utf-8"), "image/jpeg")
                    )
            return frames


# Singleton instance for easy import
ai_service = AIAssetIntelligenceService()
