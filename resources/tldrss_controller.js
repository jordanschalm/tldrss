var app = angular.module('tldrss_controller', []);
app.controller('tldrssCtrl', function($scope, $http) {
	$scope.createFeed = function(host, rule) {
		$http.post('/create-feed', {host: $scope.host, rule: $scope.rule})
		.success(function(response) {
				// Called asynchronously when the response is available
				$scope.feedID = response.feedID;
				$scope.invalidHost = response.invalidHost;
				if($scope.invalidHost) {
					$scope.feedCreated = false;
				}
				else {
					$scope.feedCreated = true;
				}
				// Reset inputs
				$scope.host = '';
				$scope.rule = 2;
			});
	};
});