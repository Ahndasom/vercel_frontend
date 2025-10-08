from flask import Blueprint, jsonify, request
import requests
import os

# 채널 상세 모달 블루프린트
channel_detail_bp = Blueprint('channel_detail', __name__)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

@channel_detail_bp.route('/proxy/channels/<channel_id>')
def proxy_channel_detail(channel_id):
    """채널 상세 정보 백엔드 API 프록시 (CORS 우회용)"""
    start_date = request.args.get('start')
    end_date = request.args.get('end')
    severity = request.args.get('severity', 'all')

    if not start_date or not end_date:
        return jsonify({"error": "start and end parameters required"}), 400

    try:
        # 실제 백엔드 호출
        backend_url = f"{BACKEND_URL}/api/v1/channels/{channel_id}?start={start_date}&end={end_date}&severity={severity}"
        response = requests.get(backend_url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print(f"[CHANNEL_DETAIL] API 호출 성공 - Channel {channel_id}: {data}")
            return jsonify(data)
        else:
            error_msg = f"Backend returned {response.status_code}"
            print(f"[CHANNEL_DETAIL] API 오류 - Channel {channel_id}: {error_msg}")
            return jsonify({"error": error_msg}), response.status_code

    except requests.RequestException as e:
        error_msg = f"Backend connection failed: {str(e)}"
        print(f"[CHANNEL_DETAIL] 연결 오류 - Channel {channel_id}: {error_msg}")
        return jsonify({"error": error_msg}), 500


class ChannelDetailModalComponent:
    """채널 상세 모달 컴포넌트 클래스"""

    @staticmethod
    def format_channel_detail_data(raw_data, channel_id):
        """채널 상세 정보 데이터 포맷"""
        if not raw_data:
            return ChannelDetailModalComponent._get_empty_channel_data(channel_id)

        return {
            'channel_id': raw_data.get('channel_id', channel_id),
            'name': raw_data.get('name', f"CH{str(channel_id).zfill(2)}"),
            'channel_display': f"CH{str(raw_data.get('channel_id', channel_id)).zfill(2)}",
            'counts': raw_data.get('counts', {'total': 0, 'critical': 0, 'warn': 0, 'info': 0}),
            'by_type': raw_data.get('by_type', []),
            'status': raw_data.get('status', 'OFF'),
            'location_info': {
                'fov_location_name': raw_data.get('fov_location_name', '정보 없음'),
                'area_name': raw_data.get('area_name', '정보 없음'),
                'emap_image_url': raw_data.get('emap_image_url'),
                'fov_thumbnail_url': raw_data.get('fov_thumbnail_url'),
                'position': raw_data.get('position')
            },
            'range': raw_data.get('range', {'start': 'N/A', 'end': 'N/A'})
        }

    @staticmethod
    def _get_empty_channel_data(channel_id):
        """빈 채널 데이터 반환"""
        return {
            'channel_id': channel_id,
            'name': f"CH{str(channel_id).zfill(2)}",
            'channel_display': f"CH{str(channel_id).zfill(2)}",
            'counts': {'total': 0, 'critical': 0, 'warn': 0, 'info': 0},
            'by_type': [],
            'status': 'OFF',
            'location_info': {
                'fov_location_name': '정보 없음',
                'area_name': '정보 없음',
                'emap_image_url': None,
                'fov_thumbnail_url': None,
                'position': None
            },
            'range': {'start': 'N/A', 'end': 'N/A'}
        }

    @staticmethod
    def format_detail_section_html(channel_data):
        """상세 정보 섹션 HTML 생성"""
        counts = channel_data['counts']

        html = f"""
        <div class="detail-item">
            <span>총 이벤트:</span>
            <strong>{counts['total']}건</strong>
        </div>
        <div class="detail-item">
            <span>Critical:</span>
            <strong>{counts['critical']}건</strong>
        </div>
        <div class="detail-item">
            <span>Warning:</span>
            <strong>{counts['warn']}건</strong>
        </div>
        <div class="detail-item">
            <span>Info:</span>
            <strong>{counts['info']}건</strong>
        </div>
        """

        if channel_data['by_type']:
            html += '<div style="border-top: 1px solid #dee2e6; margin: 15px 0; padding-top: 15px;"></div>'
            for event_type in channel_data['by_type']:
                html += f"""
                <div class="detail-item">
                    <span>{event_type.get('label', event_type.get('type_name', 'Unknown'))}:</span>
                    <strong>{event_type.get('count', 0)}건</strong>
                </div>
                """

        return html

    @staticmethod
    def format_location_info_html(channel_data):
        """위치 정보 섹션 HTML 생성"""
        location = channel_data['location_info']
        channel_display = channel_data['channel_display']

        return f"""
        <div class="location-item">
            <h4>채널 번호</h4>
            <p>{channel_display}</p>
        </div>
        <div class="location-item">
            <h4>설비명</h4>
            <p>{location['fov_location_name']}</p>
        </div>
        <div class="location-item">
            <h4>공정명</h4>
            <p>{location['area_name']}</p>
        </div>
        <div class="location-item">
            <h4>상태</h4>
            <p>{channel_data['status']}</p>
        </div>
        """

    @staticmethod
    def format_archive_section_html(channel_data):
        """아카이브 섹션 HTML 생성"""
        channel_display = channel_data['channel_display']

        if channel_data['by_type'] and len(channel_data['by_type']) > 0:
            html = ""
            for event_type in channel_data['by_type']:
                html += f"""
                <div class="archive-item">
                    <h4 class="archive-subtitle">{event_type.get('label', 'Unknown')} ({event_type.get('count', 0)}건)</h4>
                    <div class="detail-item">
                        <span>발생 건수:</span>
                        <strong>{event_type.get('count', 0)}건</strong>
                    </div>
                </div>
                """
        else:
            html = f"""
            <div class="archive-item">
                <h4 class="archive-subtitle">표시할 이벤트 아카이브가 없습니다</h4>
                <div class="detail-item">
                    <span>기간:</span>
                    <strong>{channel_data['range']['start']} ~ {channel_data['range']['end']}</strong>
                </div>
                <div class="detail-item">
                    <span>총 이벤트:</span>
                    <strong>{channel_data['counts']['total']}건</strong>
                </div>
            </div>
            """

        return html

    @staticmethod
    def get_channel_severity_summary(channel_data):
        """채널별 중요도 요약 통계"""
        counts = channel_data['counts']
        total = counts['total']

        if total == 0:
            return {
                'critical_rate': 0,
                'warn_rate': 0,
                'info_rate': 0,
                'severity_level': 'normal'
            }

        critical_rate = round((counts['critical'] / total) * 100, 1)
        warn_rate = round((counts['warn'] / total) * 100, 1)
        info_rate = round((counts['info'] / total) * 100, 1)

        # 심각도 레벨 결정
        if critical_rate >= 30:
            severity_level = 'high'
        elif critical_rate >= 10 or warn_rate >= 50:
            severity_level = 'medium'
        else:
            severity_level = 'normal'

        return {
            'critical_rate': critical_rate,
            'warn_rate': warn_rate,
            'info_rate': info_rate,
            'severity_level': severity_level
        }


class ChannelImageUtils:
    """채널 이미지 관련 유틸리티"""

    @staticmethod
    def get_emap_image_path(image_filename):
        """E-MAP 이미지 경로 생성"""
        if not image_filename:
            return None
        return f"/static/emap/{image_filename}"

    @staticmethod
    def get_fov_thumbnail_path(thumbnail_filename):
        """FOV 썸네일 이미지 경로 생성"""
        if not thumbnail_filename:
            return None
        return f"/static/fov_thumbnails/{thumbnail_filename}"

    @staticmethod
    def validate_image_url(image_url):
        """이미지 URL 유효성 검사"""
        if not image_url:
            return False, "이미지 URL이 없습니다"

        # 간단한 유효성 검사 (실제로는 더 복잡한 검증 필요)
        valid_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp']
        if not any(image_url.lower().endswith(ext) for ext in valid_extensions):
            return False, "지원하지 않는 이미지 형식입니다"

        return True, "유효한 이미지 URL입니다"

    @staticmethod
    def generate_camera_marker_style(position, status):
        """카메라 마커 스타일 생성"""
        if not position:
            return None

        status_class = f"status-{status.lower()}" if status else "status-off"

        return {
            'left': f"{position.get('x', 0)}%",
            'top': f"{position.get('y', 0)}%",
            'class': f"camera-marker {status_class}"
        }


class ChannelModalEventHandlers:
    """채널 모달 이벤트 핸들러"""

    @staticmethod
    def handle_modal_open(channel_id, channel_data):
        """모달 오픈 이벤트 처리"""
        print(f"[MODAL] 채널 {channel_id} 모달 열림")